// Roster sources for the Lab pickers: the user's finished characters and the combat-ready NPCs
// (stat_block present) across their adventures. Both convert through the SHARED @rules/combat
// initiator converters (characterToSetup / npcStatBlockToSetup) so a token built here is identical
// to one the live combat initiator would build - one truth, no Lab-local stat derivation.

import { supabase } from '@/lib/supabase'
import type { AbilityKey } from '@rules/character'
import { characterToSetup, npcStatBlockToSetup } from '@rules/combat'
import type { NpcStatBlock } from '@rules/guide'

import { labStatsFromSetup } from '../types'
import type { LabStats, RosterCharacter, RosterNpc } from '../types'

interface CharacterRosterRow {
  id: string
  name: string
  level: number
  abilities: Partial<Record<AbilityKey, number>> | null
  ability_bonuses: Partial<Record<AbilityKey, number>> | null
  hp_max: number | null
}

function characterStats(row: CharacterRosterRow): LabStats {
  return labStatsFromSetup(characterToSetup({
    id: row.id, name: row.name, level: row.level,
    abilities: row.abilities, abilityBonuses: row.ability_bonuses, hpMax: row.hp_max,
  }))
}

export async function listRosterCharacters(): Promise<RosterCharacter[]> {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, level, abilities, ability_bonuses, hp_max')
    .eq('is_complete', true)
    .order('name')
  if (error) throw new Error(`Characters load failed: ${error.message}`)
  return ((data ?? []) as CharacterRosterRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    level: row.level,
    stats: characterStats(row),
  }))
}

function npcStats(statBlock: NpcStatBlock): LabStats {
  return labStatsFromSetup(npcStatBlockToSetup(statBlock, { id: '', name: '', refId: null }))
}

interface NpcRosterRow {
  id: string
  name: string
  role: string
  adventure_id: string
  stat_block: NpcStatBlock | null
}

export async function listRosterNpcs(): Promise<RosterNpc[]> {
  const [npcs, adventures] = await Promise.all([
    supabase.from('npcs').select('id, name, role, adventure_id, stat_block').not('stat_block', 'is', null),
    supabase.from('adventures').select('id, title'),
  ])
  if (npcs.error) throw new Error(`NPCs load failed: ${npcs.error.message}`)
  const titles = new Map(
    ((adventures.data ?? []) as { id: string; title: string }[]).map((a) => [a.id, a.title || 'Untitled']),
  )
  return ((npcs.data ?? []) as NpcRosterRow[])
    .filter((row): row is NpcRosterRow & { stat_block: NpcStatBlock } => row.stat_block !== null)
    .map((row) => ({
      id: row.id,
      name: row.name,
      role: row.role,
      adventureTitle: titles.get(row.adventure_id) ?? 'Unknown adventure',
      stats: npcStats(row.stat_block),
    }))
}
