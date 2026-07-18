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
  abilities: AbilityScores
  ability_bonuses: Partial<Record<AbilityKey, number>>
  skill_proficiencies: string[]
}

export const CHARACTER_COLUMNS = 'id, user_id, name, level, class_key, abilities, ability_bonuses, skill_proficiencies'

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
