import { describe, expect, it } from 'vitest'

import { CHARACTER_FIXTURES } from './__fixtures__/characters.ts'
import { abilityModifier, applyAbilityBonuses, validateAbilityBonusAssignment } from './abilities.ts'
import {
  armorClass,
  hitPointsMaxAtLevelOne,
  proficiencyBonus,
  savingThrowModifier,
  skillModifier,
} from './character-math.ts'
import { ABILITY_KEYS } from './types.ts'

describe('character-math golden fixtures (SRD 5.2.1 hand-calculated)', () => {
  for (const fixture of CHARACTER_FIXTURES) {
    describe(fixture.name, () => {
      const finalAbilities = applyAbilityBonuses(fixture.baseAbilities, fixture.abilityBonuses)
      const modifiers = Object.fromEntries(
        ABILITY_KEYS.map((key) => [key, abilityModifier(finalAbilities[key])]),
      )
      const profBonus = proficiencyBonus(1)

      it('ASI assignment is valid against the background', () => {
        const result = validateAbilityBonusAssignment(
          fixture.abilityBonuses,
          fixture.backgroundEligibleAbilities,
        )
        expect(result.valid).toBe(true)
      })

      it('final ability scores match', () => {
        expect(finalAbilities).toEqual(fixture.expected.finalAbilities)
      })

      it('ability modifiers match', () => {
        expect(modifiers).toEqual(fixture.expected.modifiers)
      })

      it('proficiency bonus at level 1 is +2', () => {
        expect(profBonus).toBe(fixture.expected.proficiencyBonus)
      })

      it('armor class (unarmored) matches', () => {
        expect(armorClass({ dexModifier: modifiers.dex })).toBe(fixture.expected.armorClass)
      })

      it('HP max at level 1 matches', () => {
        expect(hitPointsMaxAtLevelOne(fixture.hitDice, modifiers.con)).toBe(fixture.expected.hpMax)
      })

      it('saving throw modifiers match', () => {
        for (const key of ABILITY_KEYS) {
          const isProficient = fixture.savingThrowProficiencies.includes(key)
          const expected = fixture.expected.savingThrows[key]
          if (expected === undefined) continue
          expect(savingThrowModifier(modifiers[key], isProficient, profBonus)).toBe(expected)
        }
      })

      it('skill modifiers match', () => {
        for (const { skill, ability } of fixture.skillProficiencies) {
          expect(skillModifier(modifiers[ability], true, profBonus)).toBe(
            fixture.expected.skills[skill],
          )
        }
      })
    })
  }
})
