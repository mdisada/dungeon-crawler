import { describe, expect, it } from 'vitest'

import { indexSrdMonsters, srdLookupNames, srdMonsterToSetup } from './srd-monsters.ts'
import type { SrdMonsterRow } from './srd-monsters.ts'

/** The shape of a real `srd_monsters` row (SRD 5.2.1 Guard, trimmed to the fields read). */
const guard: SrdMonsterRow = {
  name: 'Guard',
  armor_class: 16,
  hit_points: 11,
  data: {
    type: { key: 'humanoid', name: 'Humanoid' },
    speed: { unit: 'feet', walk: 30 },
    ability_scores: { strength: 13, dexterity: 12, constitution: 12, intelligence: 10, wisdom: 11, charisma: 10 },
    actions: [
      {
        name: 'Spear',
        action_type: 'ACTION',
        attacks: [
          {
            reach: 5, range: 20, long_range: 60, to_hit_mod: 3,
            damage_die_type: 'D6', damage_die_count: 1, damage_bonus: 1,
          },
        ],
      },
    ],
  },
}

const skeleton: SrdMonsterRow = {
  name: 'Skeleton',
  armor_class: 14,
  hit_points: 13,
  data: {
    type: { key: 'undead', name: 'Undead' },
    speed: { unit: 'feet', walk: 30 },
    ability_scores: { strength: 10, dexterity: 16, constitution: 15, intelligence: 6, wisdom: 8, charisma: 5 },
    actions: [
      {
        name: 'Shortsword',
        action_type: 'ACTION',
        attacks: [{ reach: 5, to_hit_mod: 5, damage_die_type: 'D6', damage_die_count: 1, damage_bonus: 3 }],
      },
    ],
  },
}

describe('srdMonsterToSetup', () => {
  it('converts AC, HP, speed and ability modifiers', () => {
    const setup = srdMonsterToSetup(guard, { id: 'e0', name: 'Dock Guard' })!
    expect(setup.ac).toBe(16)
    expect(setup.hpMax).toBe(11)
    expect(setup.speed).toBe(6)
    expect(setup.dexMod).toBe(1)
    expect(setup.saves?.str).toBe(1)
  })

  it('keeps the AUTHORED name, not the SRD one', () => {
    expect(srdMonsterToSetup(guard, { id: 'e0', name: 'Dock Guard' })!.name).toBe('Dock Guard')
  })

  it('emits both halves of a melee-or-ranged attack', () => {
    const attacks = srdMonsterToSetup(guard, { id: 'e0', name: 'Guard' })!.attacks
    expect(attacks.map((a) => a.kind)).toEqual(['melee', 'ranged'])
    expect(attacks[0]).toMatchObject({ toHit: 3, range: 1, damage: { count: 1, sides: 6, bonus: 1 } })
    expect(attacks[1]).toMatchObject({ range: 4, longRange: 12 })
  })

  it('gives the undead no morale to break', () => {
    expect(srdMonsterToSetup(skeleton, { id: 'e0', name: 'Skeleton' })!.morale).toBe(0)
    expect(srdMonsterToSetup(guard, { id: 'e0', name: 'Guard' })!.morale).toBeGreaterThan(0)
  })

  it('returns null when the row carries no usable attack', () => {
    const traitsOnly: SrdMonsterRow = { name: 'Gas Spore', armor_class: 5, hit_points: 1, data: { actions: [] } }
    expect(srdMonsterToSetup(traitsOnly, { id: 'e0', name: 'Gas Spore' })).toBeNull()
  })
})

describe('srd name matching', () => {
  it('looks a reskin up by its head noun', () => {
    expect(srdLookupNames("Vane's Hired Thug")).toEqual(["Vane's Hired Thug", 'thug'])
    expect(srdLookupNames('Guard')).toEqual(['Guard'])
  })

  it('indexes monsters by their exact name', () => {
    const index = indexSrdMonsters([guard, skeleton])
    expect(index.get('guard')).toBe(guard)
    expect(index.get('skeleton')).toBe(skeleton)
  })

  it('indexes a variant under its species, so "Sahuagin" reaches "Sahuagin Warrior"', () => {
    const warrior: SrdMonsterRow = { ...guard, name: 'Sahuagin Warrior' }
    expect(indexSrdMonsters([warrior]).get('sahuagin')).toBe(warrior)
  })

  it('never indexes a qualifier as a species', () => {
    const index = indexSrdMonsters([{ ...guard, name: 'Giant Spider' }])
    expect(index.get('giant')).toBeUndefined()
    expect(index.get('giant spider')).toBeDefined()
  })

  it('lets an exact name win over a species alias', () => {
    const captain: SrdMonsterRow = { ...guard, name: 'Bandit Captain' }
    const bandit: SrdMonsterRow = { ...guard, name: 'Bandit' }
    expect(indexSrdMonsters([captain, bandit]).get('bandit')).toBe(bandit)
  })
})
