// Shared plumbing for the Phase 5 intent pipeline: play-session guards, server-side skill
// math, dialogue-line diffs, and the pending-prompt stash. Every flow module (intent,
// npc-dialogue, narration) builds on these.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  abilityModifier, applyAbilityBonuses, proficiencyBonus, SKILL_ABILITY, skillModifier,
} from '../_shared/character/index.ts'
import type { AbilityKey, AbilityScores, SkillName } from '../_shared/character/index.ts'
import type { PendingPromptState } from '../_shared/state/index.ts'
import type { DialogueLine, GameState, Json, StateDiff } from '../_shared/state/index.ts'
import { assertOk, loadContext } from './util.ts'
import type { AdventureRow, MemberRow } from './util.ts'

const LINE_HISTORY_LIMIT = 100

export interface CharacterRow {
  id: string
  user_id: string
  name: string
  level: number
  class_key: string | null
  race_key: string | null
  background_key: string | null
  abilities: AbilityScores
  ability_bonuses: Partial<Record<AbilityKey, number>>
  skill_proficiencies: string[]
  personality: Json
  freeform_text: string | null
  background_narrative: string | null
}

export const CHARACTER_COLUMNS =
  'id, user_id, name, level, class_key, race_key, background_key, abilities, ability_bonuses, ' +
  'skill_proficiencies, personality, freeform_text, background_narrative'

export interface PlayContext {
  adventure: AdventureRow
  member: MemberRow | null
  isDm: boolean
  isCreator: boolean
  sessionId: string
  demo: boolean
}

export type Guarded<T> = { ok: true; value: T } | { ok: false; status: number; error: string }

/** Common guard for all live-play actions: member, not spectator, session active. */
export async function loadPlayContext(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  state: GameState,
): Promise<Guarded<PlayContext>> {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { ok: false, status: 404, error: 'Adventure not found' }
  if (ctx.member?.spectator) return { ok: false, status: 403, error: 'Spectators cannot act' }
  if (!state.session.id || state.session.status !== 'active') {
    return { ok: false, status: 409, error: 'No active session' }
  }
  return {
    ok: true,
    value: {
      adventure: ctx.adventure,
      member: ctx.member,
      isDm: ctx.isDm,
      isCreator: ctx.isCreator,
      sessionId: state.session.id,
      demo: ctx.adventure.demo,
    },
  }
}

export async function loadCharacter(service: SupabaseClient, characterId: string): Promise<CharacterRow | null> {
  const { data, error } = await service
    .from('characters')
    .select(CHARACTER_COLUMNS)
    .eq('id', characterId)
    .maybeSingle()
  assertOk(error, 'character load failed')
  return data as CharacterRow | null
}

/** Non-spectator player character ids - the roster group prompts and encounters draw from. */
export async function activePcIds(service: SupabaseClient, adventureId: string): Promise<string[]> {
  const { data, error } = await service
    .from('adventure_members')
    .select('character_id, spectator, role')
    .eq('adventure_id', adventureId)
  assertOk(error, 'members load failed')
  return (data ?? [])
    .filter((m) => m.role === 'player' && !m.spectator && m.character_id)
    .map((m) => m.character_id as string)
}

export async function loadPartyCharacters(service: SupabaseClient, adventureId: string): Promise<CharacterRow[]> {
  const { data: members, error } = await service
    .from('adventure_members')
    .select('character_id, spectator')
    .eq('adventure_id', adventureId)
  assertOk(error, 'members load failed')
  const ids = (members ?? []).filter((m) => !m.spectator && m.character_id).map((m) => m.character_id as string)
  if (ids.length === 0) return []
  const { data: chars, error: charsError } = await service.from('characters').select(CHARACTER_COLUMNS).in('id', ids)
  assertOk(charsError, 'party characters load failed')
  return (chars ?? []) as CharacterRow[]
}

/** Case-insensitive skill -> ability lookup ("athletics" matches "Athletics"). */
export function skillModifierFor(character: CharacterRow, skill: string): number {
  const entry = (Object.keys(SKILL_ABILITY) as SkillName[]).find((s) => s.toLowerCase() === skill.toLowerCase())
  if (!entry) return 0
  const scores = applyAbilityBonuses(character.abilities, character.ability_bonuses ?? {})
  const mod = abilityModifier(scores[SKILL_ABILITY[entry]])
  const proficient = (character.skill_proficiencies ?? []).some((s) => s.toLowerCase() === skill.toLowerCase())
  return skillModifier(mod, proficient, proficiencyBonus(character.level))
}

export function partySkillList(characters: CharacterRow[]): string[] {
  return [...new Set(characters.flatMap((c) => c.skill_proficiencies ?? []))]
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim()

/** String leaves of the freeform personality jsonb, capped - quirks, not essays. */
function personalityBits(personality: Json): string[] {
  const bits: string[] = []
  const walk = (value: Json) => {
    if (bits.length >= 3) return
    if (typeof value === 'string' && value.trim()) bits.push(clean(value).slice(0, 70))
    else if (Array.isArray(value)) value.forEach(walk)
    else if (typeof value === 'object' && value !== null) Object.values(value).forEach(walk)
  }
  walk(personality)
  return bits
}

/**
 * One personalization line per character (2026-07-20 playtest): species + traits (a dwarf's
 * Darkvision must count when adjudicating darkness), background, and quirks - fed to the
 * Adjudicator, Narrator, NPC bundle, and Beat Planner so play reads and rules personal.
 */
export async function characterProfiles(
  service: SupabaseClient,
  characters: CharacterRow[],
): Promise<Record<string, string>> {
  const raceKeys = [...new Set(characters.map((c) => c.race_key).filter((k): k is string => Boolean(k)))]
  const { data } = raceKeys.length > 0
    ? await service.from('srd_races').select('key, name, traits').in('key', raceKeys)
    : { data: [] }
  const races = new Map(
    ((data ?? []) as { key: string; name: string; traits: Json }[]).map((r) => [r.key, r]),
  )
  const profiles: Record<string, string> = {}
  for (const c of characters) {
    const race = c.race_key ? races.get(c.race_key) : undefined
    const traits = (Array.isArray(race?.traits) ? race!.traits : [])
      .flatMap((t): string[] => {
        if (typeof t !== 'object' || t === null || Array.isArray(t)) return []
        const trait = t as { name?: Json; desc?: Json }
        if (typeof trait.name !== 'string' || ['Size', 'Speed'].includes(trait.name)) return []
        const desc = typeof trait.desc === 'string' ? ` (${clean(trait.desc).slice(0, 90)})` : ''
        return [`${trait.name}${desc}`]
      })
      .slice(0, 4)
    const quirks = personalityBits(c.personality ?? null)
    if (c.freeform_text?.trim()) quirks.push(clean(c.freeform_text).slice(0, 100))
    profiles[c.id] =
      `${c.name} - ${race?.name ?? 'human'} ${c.class_key ?? 'adventurer'}` +
      `${c.background_key ? ` (${c.background_key} background)` : ''}, level ${c.level}.` +
      (traits.length > 0 ? ` Species traits: ${traits.join('; ')}.` : '') +
      (quirks.length > 0 ? ` Personality/quirks: ${quirks.slice(0, 4).join('; ')}.` : '') +
      (c.background_narrative?.trim() ? ` Backstory: ${clean(c.background_narrative).slice(0, 120)}.` : '')
  }
  return profiles
}

/** Convenience: the whole party's profile lines (order preserved). */
export async function partyProfileLines(service: SupabaseClient, characters: CharacterRow[]): Promise<string[]> {
  const profiles = await characterProfiles(service, characters)
  return characters.map((c) => profiles[c.id]).filter(Boolean)
}

export function newLine(speaker: string | null, npcId: string | null, text: string): DialogueLine {
  return { id: crypto.randomUUID(), speaker, npcId, text }
}

/** Bounded dialogue append; also drives activeLineId so renderers reveal the newest line. */
export function appendLinesDiff(state: GameState, lines: DialogueLine[], extra?: Record<string, Json>): StateDiff {
  const all = [...state.dialogue.lines, ...lines].slice(-LINE_HISTORY_LIMIT)
  return {
    domain: 'dialogue',
    patch: {
      lines: all as unknown as Json,
      activeLineId: lines.length > 0 ? lines[lines.length - 1].id : state.dialogue.activeLineId,
      ...(extra ?? {}),
    },
  }
}

export function typingDiff(typing: boolean): StateDiff {
  return { domain: 'dialogue', patch: { typing } }
}

/** Sets/clears the single blocking prompt + its server-side context stash (dm-only). */
export function pendingDiffs(prompt: PendingPromptState | null, context: Json | null): StateDiff[] {
  return [
    { domain: 'dialogue', patch: { pending: prompt as unknown as Json } },
    { domain: 'dm', patch: { conversation: { pendingContext: context } } },
  ]
}

export function pcLineCounts(state: GameState): Map<string, number> {
  const byName = new Map(state.players.list.map((p) => [p.name, p.characterId]))
  const counts = new Map<string, number>(state.players.list.map((p) => [p.characterId, 0]))
  for (const line of state.dialogue.lines) {
    if (!line.speaker || line.npcId) continue
    const characterId = byName.get(line.speaker)
    if (characterId) counts.set(characterId, (counts.get(characterId) ?? 0) + 1)
  }
  return counts
}
