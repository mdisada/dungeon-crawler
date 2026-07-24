// Story-encounter replay data (F09 SS11.1): the authored `encounters` (type='battle') the Lab can
// rebuild into the exact CombatManifest live play would, plus the per-adventure combat context the
// initiator joins - the adventure's stat-blocked NPCs (for enemy name-match + the boss role), the
// user's characters (the deployed party), and the difficulty baseline. This module only READS
// authored data; it never writes to a session (the Lab never invokes the spine).

import { supabase } from '@/lib/supabase'
import type { ManifestNpcRow, PartyMemberInput } from '@rules/combat'
import type { NpcStatBlock } from '@rules/guide'

export interface EnemyLine {
  name: string
  cr: string
  count: number
}

export interface CombatEncounterOption {
  id: string
  adventureId: string
  adventureTitle: string
  summary: string
  enemies: EnemyLine[]
  outcomeAtoms: string[]
}

export interface AdventureCombatContext {
  npcs: ManifestNpcRow[]
  /** The role='boss' npc for this adventure, if any (the manifest's explicit boss candidate). */
  boss: { id: string; name: string } | null
  party: PartyMemberInput[]
  baselinePreset: string
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {}
}

function parseEnemies(spec: unknown): EnemyLine[] {
  const raw = asRecord(spec).enemies
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => {
    const row = asRecord(e)
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) return []
    return [{
      name,
      cr: typeof row.cr === 'string' ? row.cr : '1/4',
      count: typeof row.count === 'number' && row.count > 0 ? Math.round(row.count) : 1,
    }]
  })
}

interface EncounterRow {
  id: string
  adventure_id: string
  spec: unknown
  outcome_atoms: unknown
}

/**
 * Every authored combat encounter the user can see (RLS-scoped to their adventures), keyed for a
 * grouped picker. Encounters with no enemy lines are dropped - there is no fight to replay.
 */
export async function listCombatEncounters(): Promise<CombatEncounterOption[]> {
  const [encRes, advRes] = await Promise.all([
    supabase.from('encounters').select('id, adventure_id, spec, outcome_atoms').eq('type', 'battle'),
    supabase.from('adventures').select('id, title'),
  ])
  if (encRes.error) throw new Error(`Encounters load failed: ${encRes.error.message}`)
  if (advRes.error) throw new Error(`Adventures load failed: ${advRes.error.message}`)
  const titles = new Map(
    ((advRes.data ?? []) as { id: string; title: string }[]).map((a) => [a.id, a.title || 'Untitled']),
  )
  return ((encRes.data ?? []) as EncounterRow[])
    .map((row) => ({
      id: row.id,
      adventureId: row.adventure_id,
      adventureTitle: titles.get(row.adventure_id) ?? 'Unknown adventure',
      summary: typeof asRecord(row.spec).summary === 'string' ? (asRecord(row.spec).summary as string) : '',
      enemies: parseEnemies(row.spec),
      outcomeAtoms: Array.isArray(row.outcome_atoms)
        ? (row.outcome_atoms as unknown[]).filter((a): a is string => typeof a === 'string')
        : [],
    }))
    .filter((e) => e.enemies.length > 0)
}

interface NpcContextRow {
  id: string
  name: string
  role: string
  stat_block: NpcStatBlock | null
}

interface CharacterContextRow {
  id: string
  name: string
  level: number
  abilities: PartyMemberInput['abilities']
  ability_bonuses: PartyMemberInput['abilityBonuses']
  hp_max: number | null
}

/** The joinable context for one adventure's fights: its combat NPCs, boss, party, and difficulty. */
export async function loadAdventureCombatContext(adventureId: string): Promise<AdventureCombatContext> {
  const [npcRes, advRes, charRes] = await Promise.all([
    supabase.from('npcs').select('id, name, role, stat_block').eq('adventure_id', adventureId).not('stat_block', 'is', null),
    supabase.from('adventures').select('difficulty_setting').eq('id', adventureId).single(),
    supabase.from('characters').select('id, name, level, abilities, ability_bonuses, hp_max').eq('is_complete', true).order('name'),
  ])
  if (npcRes.error) throw new Error(`Adventure NPCs load failed: ${npcRes.error.message}`)
  if (charRes.error) throw new Error(`Characters load failed: ${charRes.error.message}`)

  const npcs: ManifestNpcRow[] = ((npcRes.data ?? []) as NpcContextRow[])
    .filter((n): n is NpcContextRow & { stat_block: NpcStatBlock } => n.stat_block !== null)
    .map((n) => ({ id: n.id, name: n.name, role: n.role === 'boss' ? 'boss' : 'npc', statBlock: n.stat_block }))
  const bossRow = npcs.find((n) => n.role === 'boss') ?? null

  const preset = asRecord(advRes.data?.difficulty_setting).preset
  const party: PartyMemberInput[] = ((charRes.data ?? []) as CharacterContextRow[]).map((c) => ({
    id: c.id, name: c.name, level: c.level, abilities: c.abilities, abilityBonuses: c.ability_bonuses, hpMax: c.hp_max,
  }))

  return {
    npcs,
    boss: bossRow ? { id: bossRow.id, name: bossRow.name } : null,
    party,
    baselinePreset: typeof preset === 'string' ? preset : 'standard',
  }
}
