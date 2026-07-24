// Roster sources for the Lab pickers: the user's finished characters and the combat-ready
// NPCs (stat_block present) across their adventures. PC attack derivation is deliberately
// generic for Phase 1 - a melee and a ranged option from ability mods + proficiency - since
// characters.equipment is untyped; every number is live-editable in the Lab anyway.

import { supabase } from '@/lib/supabase'
import { abilityModifier, proficiencyBonus } from '@rules/character'
import type { AbilityKey } from '@rules/character'
import { parseDiceExpr } from '@rules/combat'
import type { AttackSpec, SaveModifiers } from '@rules/combat'
import type { NpcStatBlock } from '@rules/guide'

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
  const mod = (key: AbilityKey) => abilityModifier((row.abilities?.[key] ?? 10) + (row.ability_bonuses?.[key] ?? 0))
  const str = mod('str')
  const dex = mod('dex')
  const prof = proficiencyBonus(row.level || 1)
  const meleeMod = Math.max(str, dex)
  const attacks: AttackSpec[] = [
    { name: 'Melee weapon', kind: 'melee', toHit: prof + meleeMod, damage: { count: 1, sides: 8, bonus: meleeMod }, range: 1 },
    { name: 'Ranged weapon', kind: 'ranged', toHit: prof + dex, damage: { count: 1, sides: 6, bonus: dex }, range: 16, longRange: 64 },
  ]
  // Save mods = ability mod (save proficiencies deferred; live-editable in the lab).
  const saves: SaveModifiers = { str, dex, con: mod('con'), int: mod('int'), wis: mod('wis'), cha: mod('cha') }
  return { hpMax: row.hp_max ?? 10, ac: 10 + dex, speed: 6, dexMod: dex, saves, attacks, spells: [] }
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
  const ranged = statBlock.archetype === 'sniper' || statBlock.archetype === 'caster'
  const attack: AttackSpec = {
    name: statBlock.attack.name,
    kind: ranged ? 'ranged' : 'melee',
    toHit: statBlock.attack.toHit,
    damage: parseDiceExpr(statBlock.attack.damage),
    range: ranged ? (statBlock.archetype === 'caster' ? 24 : 16) : 1,
    // Spells (caster) use a single range band; thrown/bow archetypes get 5e long range.
    ...(ranged && statBlock.archetype !== 'caster' ? { longRange: 64 } : {}),
  }
  const m = statBlock.abilityModifiers
  const saves: SaveModifiers = { str: m.str, dex: m.dex, con: m.con, int: m.int, wis: m.wis, cha: m.cha }
  return {
    hpMax: statBlock.hpMax,
    ac: statBlock.ac,
    speed: Math.max(1, Math.round(statBlock.speed / 5)),
    dexMod: statBlock.abilityModifiers.dex,
    saves,
    attacks: [attack],
    spells: [],
  }
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
