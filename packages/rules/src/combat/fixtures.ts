// SRD 5.1 monster fixtures for the Combat Lab enemy picker and the engine's golden tests.
// Speeds are grid squares (feet / 5); ranged range 16 = 80 ft normal range (long-range
// disadvantage bands are out of scope for Phase 1).

import { findSpell } from './spell-library.ts'
import type { AttackSpec, CombatantSetup, CombatSide, SaveModifiers, SpellSpec } from './types.ts'

export interface MonsterFixture {
  key: string
  name: string
  hpMax: number
  ac: number
  speed: number
  dexMod: number
  attacks: AttackSpec[]
  /** Saving-throw modifiers (ability mods); dex defaults to dexMod when omitted. */
  saves?: Partial<SaveModifiers>
  /** Spell names resolved against the library; casters carry a small kit. */
  spellNames?: string[]
}

const melee = (name: string, toHit: number, count: number, sides: number, bonus: number): AttackSpec => ({
  name,
  kind: 'melee',
  toHit,
  damage: { count, sides, bonus },
  range: 1,
})

const ranged = (name: string, toHit: number, count: number, sides: number, bonus: number, range: number, longRange: number): AttackSpec => ({
  name,
  kind: 'ranged',
  toHit,
  damage: { count, sides, bonus },
  range,
  longRange,
})

export const MONSTER_FIXTURES: MonsterFixture[] = [
  { key: 'goblin', name: 'Goblin', hpMax: 7, ac: 15, speed: 6, dexMod: 2, attacks: [melee('Scimitar', 4, 1, 6, 2), ranged('Shortbow', 4, 1, 6, 2, 16, 64)], saves: { str: 0, dex: 2, con: 1, int: 0, wis: -1, cha: -1 } },
  { key: 'skeleton', name: 'Skeleton', hpMax: 13, ac: 13, speed: 6, dexMod: 2, attacks: [melee('Shortsword', 4, 1, 6, 2), ranged('Shortbow', 4, 1, 6, 2, 16, 64)], saves: { str: 0, dex: 2, con: 3, int: -2, wis: 0, cha: -3 } },
  { key: 'zombie', name: 'Zombie', hpMax: 22, ac: 8, speed: 4, dexMod: -2, attacks: [melee('Slam', 3, 1, 6, 1)], saves: { str: 1, dex: -2, con: 3, int: -4, wis: -2, cha: -3 } },
  { key: 'wolf', name: 'Wolf', hpMax: 11, ac: 13, speed: 8, dexMod: 2, attacks: [melee('Bite', 4, 2, 4, 2)], saves: { str: 1, dex: 2, con: 1, int: -4, wis: 1, cha: -2 } },
  { key: 'bandit', name: 'Bandit', hpMax: 11, ac: 12, speed: 6, dexMod: 1, attacks: [melee('Scimitar', 3, 1, 6, 1), ranged('Light Crossbow', 3, 1, 8, 1, 16, 64)], saves: { str: 0, dex: 1, con: 1, int: 0, wis: 0, cha: 0 } },
  { key: 'orc', name: 'Orc', hpMax: 15, ac: 13, speed: 6, dexMod: 1, attacks: [melee('Greataxe', 5, 1, 12, 3), ranged('Javelin', 5, 1, 6, 3, 6, 24)], saves: { str: 3, dex: 1, con: 3, int: -2, wis: 0, cha: 0 } },
  { key: 'ogre', name: 'Ogre', hpMax: 59, ac: 11, speed: 8, dexMod: -1, attacks: [melee('Greatclub', 6, 2, 8, 4), ranged('Javelin', 6, 2, 6, 4, 6, 24)], saves: { str: 4, dex: -1, con: 3, int: -3, wis: -2, cha: -2 } },
  // Casters - come with a spell kit so spells are testable straight from the picker.
  { key: 'mage', name: 'Mage', hpMax: 40, ac: 12, speed: 6, dexMod: 2, attacks: [melee('Dagger', 4, 1, 4, 2)], saves: { str: -1, dex: 2, con: 0, int: 3, wis: 1, cha: 0 }, spellNames: ['Fire Bolt', 'Fireball', 'Lightning Bolt'] },
  { key: 'acolyte', name: 'Acolyte', hpMax: 9, ac: 10, speed: 6, dexMod: 0, attacks: [melee('Club', 2, 1, 4, 0)], saves: { str: 0, dex: 0, con: 1, int: 0, wis: 2, cha: 0 }, spellNames: ['Sacred Flame', 'Cure Wounds'] },
  { key: 'priest', name: 'Priest', hpMax: 27, ac: 13, speed: 6, dexMod: 0, attacks: [melee('Mace', 2, 1, 6, 0)], saves: { str: 0, dex: 0, con: 1, int: 1, wis: 3, cha: 1 }, spellNames: ['Sacred Flame', 'Guiding Bolt', 'Cure Wounds', 'Shatter'] },
]

/** Builds a placeable CombatantSetup from a fixture key; the caller owns id uniqueness. */
export function monsterSetup(
  key: string,
  opts: { id: string; side?: CombatSide; x?: number; y?: number; auto?: boolean },
): CombatantSetup {
  const fixture = MONSTER_FIXTURES.find((f) => f.key === key)
  if (!fixture) throw new Error(`Unknown monster fixture: ${key}`)
  return {
    id: opts.id,
    name: fixture.name,
    side: opts.side ?? 'enemy',
    kind: 'npc',
    refId: key,
    imageUrl: null,
    x: opts.x ?? 0,
    y: opts.y ?? 0,
    hpMax: fixture.hpMax,
    ac: fixture.ac,
    speed: fixture.speed,
    dexMod: fixture.dexMod,
    saves: fixture.saves,
    attacks: fixture.attacks,
    spells: (fixture.spellNames ?? []).map((name) => findSpell(name)).filter((s): s is SpellSpec => !!s),
    auto: opts.auto ?? true,
  }
}
