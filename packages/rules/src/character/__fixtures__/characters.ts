// Hand-calculated SRD 5.2.1 golden fixtures for the character-math engine (F02 acceptance
// criteria: "Derived stats match SRD hand-calculated fixtures"). Each fixture picks a class +
// background pairing that exercises a different background ASI split (+2/+1 vs +1/+1/+1) and a
// different pair of class saving-throw/skill proficiencies.
import type { AbilityKey, AbilityScores } from '../types'

export interface CharacterFixture {
  name: string
  hitDice: string // srd_classes.hit_dice, e.g. 'D10'
  baseAbilities: AbilityScores
  abilityBonuses: Partial<Record<AbilityKey, number>>
  backgroundEligibleAbilities: AbilityKey[]
  savingThrowProficiencies: AbilityKey[]
  skillProficiencies: { skill: string; ability: AbilityKey }[]
  expected: {
    finalAbilities: AbilityScores
    modifiers: Record<AbilityKey, number>
    proficiencyBonus: number
    armorClass: number
    hpMax: number
    savingThrows: Partial<Record<AbilityKey, number>>
    skills: Record<string, number>
  }
}

export const CHARACTER_FIXTURES: CharacterFixture[] = [
  {
    name: 'Fighter + Soldier (2/1 split)',
    hitDice: 'D10',
    baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    abilityBonuses: { str: 2, con: 1 },
    backgroundEligibleAbilities: ['str', 'dex', 'con'],
    savingThrowProficiencies: ['str', 'dex'],
    skillProficiencies: [
      { skill: 'Athletics', ability: 'str' },
      { skill: 'Intimidation', ability: 'cha' },
    ],
    expected: {
      finalAbilities: { str: 17, dex: 14, con: 14, int: 12, wis: 10, cha: 8 },
      modifiers: { str: 3, dex: 2, con: 2, int: 1, wis: 0, cha: -1 },
      proficiencyBonus: 2,
      armorClass: 12,
      hpMax: 12,
      savingThrows: { str: 5, dex: 4, con: 2 },
      skills: { Athletics: 5, Intimidation: 1 },
    },
  },
  {
    name: 'Wizard + Sage (1/1/1 split)',
    hitDice: 'D6',
    baseAbilities: { str: 10, dex: 13, con: 12, int: 15, wis: 14, cha: 8 },
    abilityBonuses: { con: 1, int: 1, wis: 1 },
    backgroundEligibleAbilities: ['con', 'int', 'wis'],
    savingThrowProficiencies: ['int', 'wis'],
    skillProficiencies: [
      { skill: 'Arcana', ability: 'int' },
      { skill: 'History', ability: 'int' },
    ],
    expected: {
      finalAbilities: { str: 10, dex: 13, con: 13, int: 16, wis: 15, cha: 8 },
      modifiers: { str: 0, dex: 1, con: 1, int: 3, wis: 2, cha: -1 },
      proficiencyBonus: 2,
      armorClass: 11,
      hpMax: 7,
      savingThrows: { int: 5, wis: 4, str: 0 },
      skills: { Arcana: 5, History: 5 },
    },
  },
  {
    name: 'Rogue + Criminal (2/1 split)',
    hitDice: 'D8',
    baseAbilities: { str: 10, dex: 15, con: 14, int: 13, wis: 12, cha: 8 },
    abilityBonuses: { dex: 2, int: 1 },
    backgroundEligibleAbilities: ['dex', 'con', 'int'],
    savingThrowProficiencies: ['dex', 'int'],
    skillProficiencies: [
      { skill: 'Sleight of Hand', ability: 'dex' },
      { skill: 'Stealth', ability: 'dex' },
    ],
    expected: {
      finalAbilities: { str: 10, dex: 17, con: 14, int: 14, wis: 12, cha: 8 },
      modifiers: { str: 0, dex: 3, con: 2, int: 2, wis: 1, cha: -1 },
      proficiencyBonus: 2,
      armorClass: 13,
      hpMax: 10,
      savingThrows: { dex: 5, int: 4, con: 2 },
      skills: { 'Sleight of Hand': 5, Stealth: 5 },
    },
  },
]
