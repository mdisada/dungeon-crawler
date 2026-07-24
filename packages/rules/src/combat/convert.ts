// Shared stat-block/character -> engine CombatantSetup converters (F09 SS3.1, F09.0a). ONE
// conversion the combat initiator (manifest.ts) and the Combat Lab roster both call, replacing
// the three parallel Lab-local paths (roster npcStats/characterStats + inline fixture copy).
// Pure: plain data in, CombatantSetup out. No I/O and no session/story imports - this module is
// part of the isolation boundary, so combat never reaches into the spine.

import { parseDiceExpr } from './dice.ts'
import type { AttackSpec, CombatantSetup, CombatSide, SaveModifiers, SpellSpec } from './types.ts'
// abilityModifier is re-used from the (edge-synced) guide module; proficiency is re-declared
// below so this file never imports ../character (which sync-guide-shared.mjs does NOT copy).
import { abilityModifier } from '../guide/npc-stats.ts'
import type { NpcStatBlock } from '../guide/npc-stats.ts'

/** Proficiency bonus by level - the twin of character-math.ts proficiencyBonus, re-declared to
 * keep this module runtime-portable (mirrors why guide/npc-stats.ts re-declares its 5e math). */
function proficiencyBonusForLevel(level: number): number {
  return Math.ceil(Math.max(1, level) / 4) + 1
}

const ABILITY_KEYS = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const
type AbilityKey = (typeof ABILITY_KEYS)[number]

/** A `characters` row reduced to what a party Combatant needs. Combat stats (ac/speed/attacks)
 * are derived here because they are not stored (characters.equipment is untyped). */
export interface PartyMemberInput {
  id: string
  name: string
  level: number
  abilities: Partial<Record<AbilityKey, number>> | null
  abilityBonuses: Partial<Record<AbilityKey, number>> | null
  hpMax: number | null
  imageUrl?: string | null
}

/**
 * A character row -> a party CombatantSetup. A generic melee + ranged option is synthesized from
 * ability mods + proficiency; every number stays live-editable in the Lab. x/y are placed later
 * by the initiator (0,0 until then). PCs default to human control (`auto: false`).
 */
export function characterToSetup(member: PartyMemberInput, opts?: { auto?: boolean }): CombatantSetup {
  const mod = (k: AbilityKey) => abilityModifier((member.abilities?.[k] ?? 10) + (member.abilityBonuses?.[k] ?? 0))
  const str = mod('str')
  const dex = mod('dex')
  const prof = proficiencyBonusForLevel(member.level || 1)
  const meleeMod = Math.max(str, dex)
  const attacks: AttackSpec[] = [
    { name: 'Melee weapon', kind: 'melee', toHit: prof + meleeMod, damage: { count: 1, sides: 8, bonus: meleeMod }, range: 1 },
    { name: 'Ranged weapon', kind: 'ranged', toHit: prof + dex, damage: { count: 1, sides: 6, bonus: dex }, range: 16, longRange: 64 },
  ]
  const saves: SaveModifiers = { str, dex, con: mod('con'), int: mod('int'), wis: mod('wis'), cha: mod('cha') }
  return {
    id: member.id,
    name: member.name,
    side: 'party',
    kind: 'pc',
    refId: member.id,
    imageUrl: member.imageUrl ?? null,
    x: 0,
    y: 0,
    hpMax: member.hpMax ?? 10,
    ac: 10 + dex,
    speed: 6,
    dexMod: dex,
    saves,
    attacks,
    spells: [],
    auto: opts?.auto ?? false,
  }
}

/**
 * An NPC `stat_block` -> an enemy CombatantSetup. The block carries neither `kind`, `range`, nor
 * a `DiceExpr`, so all three are synthesized: `speed` is feet -> squares, the `damage` string is
 * parsed, and ranged-vs-melee is inferred from the archetype (sniper/caster shoot). NPCs carry no
 * castable spells in the lightweight block, so `spells` is empty. Enemies default to `auto: true`.
 */
export function npcStatBlockToSetup(
  statBlock: NpcStatBlock,
  opts: { id: string; name: string; side?: CombatSide; refId: string | null; imageUrl?: string | null; auto?: boolean },
): CombatantSetup {
  const ranged = statBlock.archetype === 'sniper' || statBlock.archetype === 'caster'
  const attack: AttackSpec = {
    name: statBlock.attack.name,
    kind: ranged ? 'ranged' : 'melee',
    toHit: statBlock.attack.toHit,
    damage: parseDiceExpr(statBlock.attack.damage),
    range: ranged ? (statBlock.archetype === 'caster' ? 24 : 16) : 1,
    ...(ranged && statBlock.archetype !== 'caster' ? { longRange: 64 } : {}),
  }
  const m = statBlock.abilityModifiers
  const saves: SaveModifiers = { str: m.str, dex: m.dex, con: m.con, int: m.int, wis: m.wis, cha: m.cha }
  return {
    id: opts.id,
    name: opts.name,
    side: opts.side ?? 'enemy',
    kind: 'npc',
    refId: opts.refId,
    imageUrl: opts.imageUrl ?? null,
    x: 0,
    y: 0,
    hpMax: statBlock.hpMax,
    ac: statBlock.ac,
    speed: Math.max(1, Math.round(statBlock.speed / 5)),
    dexMod: m.dex,
    saves,
    attacks: [attack],
    spells: [] as SpellSpec[],
    auto: opts.auto ?? true,
  }
}
