import { describe, expect, it } from 'vitest'

import { deriveNpcStatBlock } from '../guide/npc-stats.ts'
import { characterToSetup, npcStatBlockToSetup, partyArmorClass } from './convert.ts'
import type { PartyMemberInput } from './convert.ts'

// DEX 14 (+2) throughout, so each expected AC is base + the class's own DEX rule + any shield.
const member = (over: Partial<PartyMemberInput> = {}): PartyMemberInput => ({
  id: 'pc-a',
  name: 'Vex',
  level: 3,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  abilityBonuses: null,
  hpMax: 20,
  ...over,
})

describe('partyArmorClass', () => {
  it('gives heavy-armour classes their kit AC, ignoring DEX', () => {
    expect(partyArmorClass('srd-2024_fighter', 2)).toBe(18) // chain 16 + shield 2
    expect(partyArmorClass('srd-2024_fighter', 4)).toBe(18) // heavy armour caps DEX out entirely
    expect(partyArmorClass('srd-2024_paladin', 2)).toBe(18)
  })

  it('caps DEX for medium armour and adds it in full for light', () => {
    expect(partyArmorClass('srd-2024_cleric', 2)).toBe(18) // scale 14 + DEX 2 (cap) + shield 2
    expect(partyArmorClass('srd-2024_cleric', 5)).toBe(18) // cap holds
    expect(partyArmorClass('srd-2024_rogue', 2)).toBe(13) // leather 11 + DEX 2
    expect(partyArmorClass('srd-2024_rogue', 5)).toBe(16) // light armour takes all of it
  })

  it('leaves unarmoured classes on 10 + DEX', () => {
    expect(partyArmorClass('srd-2024_wizard', 2)).toBe(12)
    expect(partyArmorClass('srd-2024_sorcerer', 2)).toBe(12)
  })

  it('falls back to unarmoured for a missing or unrecognised class', () => {
    expect(partyArmorClass(null, 2)).toBe(12)
    expect(partyArmorClass(undefined, 2)).toBe(12)
    expect(partyArmorClass('srd-2024_artificer', 2)).toBe(12)
  })

  it('matches the class name whatever ruleset prefix it carries', () => {
    expect(partyArmorClass('srd-5.2.1_fighter', 2)).toBe(18)
    expect(partyArmorClass('fighter', 2)).toBe(18)
    expect(partyArmorClass('SRD-2024_Fighter', 2)).toBe(18)
  })
})

describe('characterToSetup', () => {
  it('derives AC from the class rather than DEX alone', () => {
    expect(characterToSetup(member({ classKey: 'srd-2024_fighter' })).ac).toBe(18)
    expect(characterToSetup(member({ classKey: 'srd-2024_wizard' })).ac).toBe(12)
    expect(characterToSetup(member()).ac).toBe(12)
  })

  it('leaves PCs on no morale threshold unless one is asked for', () => {
    expect(characterToSetup(member()).morale).toBe(0)
    expect(characterToSetup(member(), { morale: 0.25 }).morale).toBe(0.25)
  })
})

describe('npcStatBlockToSetup', () => {
  it('assigns a morale threshold from the archetype', () => {
    const brute = npcStatBlockToSetup(deriveNpcStatBlock({ archetype: 'brute' }, 'npc'), { id: 'e0', name: 'Thug', refId: null })
    const minion = npcStatBlockToSetup(deriveNpcStatBlock({ archetype: 'minion' }, 'npc'), { id: 'e1', name: 'Rat', refId: null })
    const boss = npcStatBlockToSetup(deriveNpcStatBlock({ archetype: 'leader' }, 'boss'), { id: 'e2', name: 'Warlord', refId: null })
    expect(minion.morale ?? 0).toBeGreaterThan(brute.morale ?? 0)
    expect(boss.morale ?? 0).toBeLessThan(brute.morale ?? 0)
  })

  it('lets an explicit morale override the archetype default', () => {
    const setup = npcStatBlockToSetup(deriveNpcStatBlock({ archetype: 'minion' }, 'npc'), {
      id: 'e0', name: 'Zealot', refId: null, morale: 0,
    })
    expect(setup.morale).toBe(0)
  })
})
