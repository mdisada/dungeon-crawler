// Shared stat-block/character -> engine CombatantSetup converters (F09 SS3.1, F09.0a). ONE
// conversion the combat initiator (manifest.ts) and the Combat Lab roster both call, replacing
// the three parallel Lab-local paths (roster npcStats/characterStats + inline fixture copy).
// Pure: plain data in, CombatantSetup out. No I/O and no session/story imports - this module is
// part of the isolation boundary, so combat never reaches into the spine.

import { parseDiceExpr } from './dice.ts'
import type { AttackSpec, CombatantSetup, CombatSide, SaveModifiers, SpellSpec } from './types.ts'
// abilityModifier is re-used from the (edge-synced) guide module; proficiency is re-declared below
// to keep this module's arithmetic self-contained (it mirrors character-math.ts's proficiencyBonus,
// the same reason guide/npc-stats.ts re-declares its 5e math).
import { armorClass } from '../character/character-math.ts'
import { abilityModifier } from '../guide/npc-stats.ts'
import type { NpcArchetype, NpcStatBlock } from '../guide/npc-stats.ts'

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
  /** `characters.class_key` (e.g. "srd-2024_fighter"); drives starting armour. Omit for unarmoured. */
  classKey?: string | null
  imageUrl?: string | null
}

interface ClassArmor {
  acBase: number
  addDexModifier: boolean
  dexModifierCap: number | null
  shield: boolean
}

/**
 * Starting-kit armour by class (SRD level-1 kits). `characters.equipment` stores only the wizard's
 * choice LABELS, never resolvable `srd_armor` keys, so the class is the best signal available - and
 * without it every PC sits at 10 + DEX, which measured out as the single biggest driver of party
 * losses (each +1 AC is worth roughly +8 points of win rate over the fixture ladder).
 *
 * Barbarian and Monk Unarmored Defence are approximated as light armour: the engine has no
 * CON/WIS-to-AC rule, and a real equipment model (F02 follow-up) supersedes this whole table.
 */
const CLASS_ARMOR: Record<string, ClassArmor> = {
  // Heavy armour, no DEX, plus a shield.
  fighter: { acBase: 16, addDexModifier: false, dexModifierCap: null, shield: true },
  paladin: { acBase: 16, addDexModifier: false, dexModifierCap: null, shield: true },
  // Medium armour, DEX capped at +2.
  cleric: { acBase: 14, addDexModifier: true, dexModifierCap: 2, shield: true },
  // Light armour (+ shield where the kit carries one).
  druid: { acBase: 11, addDexModifier: true, dexModifierCap: null, shield: true },
  ranger: { acBase: 12, addDexModifier: true, dexModifierCap: null, shield: false },
  bard: { acBase: 11, addDexModifier: true, dexModifierCap: null, shield: false },
  rogue: { acBase: 11, addDexModifier: true, dexModifierCap: null, shield: false },
  warlock: { acBase: 11, addDexModifier: true, dexModifierCap: null, shield: false },
  barbarian: { acBase: 12, addDexModifier: true, dexModifierCap: null, shield: false },
  monk: { acBase: 11, addDexModifier: true, dexModifierCap: null, shield: false },
  // No armour proficiency - unarmoured 10 + DEX.
  sorcerer: { acBase: 10, addDexModifier: true, dexModifierCap: null, shield: false },
  wizard: { acBase: 10, addDexModifier: true, dexModifierCap: null, shield: false },
}

/** Class keys are ruleset-prefixed ("srd-2024_fighter"), so match on the trailing class name. */
function classArmor(classKey: string | null | undefined): ClassArmor | null {
  if (!classKey) return null
  const name = classKey.slice(classKey.lastIndexOf('_') + 1).toLowerCase()
  return CLASS_ARMOR[name] ?? null
}

/** Effective AC for a party member: their class's starting kit, or unarmoured when unknown. */
export function partyArmorClass(classKey: string | null | undefined, dexModifier: number): number {
  const armor = classArmor(classKey)
  if (!armor) return armorClass({ dexModifier })
  return armorClass({ dexModifier, armor }) + (armor.shield ? 2 : 0)
}

/**
 * A character row -> a party CombatantSetup. A generic melee + ranged option is synthesized from
 * ability mods + proficiency, and AC from the class's starting armour (see CLASS_ARMOR); every
 * number stays live-editable in the Lab. x/y are placed later
 * by the initiator (0,0 until then). PCs default to human control (`auto: false`) and to no morale
 * threshold - whether a party retreats is a table decision, not something a PC does on its own.
 */
export function characterToSetup(
  member: PartyMemberInput,
  opts?: { auto?: boolean; morale?: number },
): CombatantSetup {
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
    ac: partyArmorClass(member.classKey, dex),
    speed: 6,
    dexMod: dex,
    saves,
    attacks,
    spells: [],
    morale: opts?.morale ?? 0,
    auto: opts?.auto ?? false,
  }
}

/**
 * Morale by archetype (F09 SS8.3): the side-strength fraction at which this kind of NPC breaks.
 * A `leader` (the boss default) holds the line longest; expendable minions break first. Authored
 * `tactics_profile` flee thresholds replace this at F09.1 - until then archetype is the only signal
 * the lightweight stat block carries.
 */
const MORALE_BY_ARCHETYPE: Record<NpcArchetype, number> = {
  brute: 0.15,
  skirmisher: 0.3,
  sniper: 0.35,
  caster: 0.35,
  leader: 0.1,
  minion: 0.4,
}

/**
 * An NPC `stat_block` -> an enemy CombatantSetup. The block carries neither `kind`, `range`, nor
 * a `DiceExpr`, so all three are synthesized: `speed` is feet -> squares, the `damage` string is
 * parsed, and ranged-vs-melee is inferred from the archetype (sniper/caster shoot). NPCs carry no
 * castable spells in the lightweight block, so `spells` is empty. Enemies default to `auto: true`.
 */
export function npcStatBlockToSetup(
  statBlock: NpcStatBlock,
  opts: {
    id: string; name: string; side?: CombatSide; refId: string | null; imageUrl?: string | null
    auto?: boolean; morale?: number
  },
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
    morale: opts.morale ?? MORALE_BY_ARCHETYPE[statBlock.archetype] ?? 0,
    auto: opts.auto ?? true,
  }
}
