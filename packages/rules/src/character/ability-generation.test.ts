import { describe, expect, it } from 'vitest'

import { validateAbilityBonusAssignment } from './abilities'
import { validatePointBuy, validateStandardArrayAssignment } from './ability-generation'

describe('validateStandardArrayAssignment', () => {
  it('accepts any permutation of the standard array', () => {
    expect(
      validateStandardArrayAssignment({ str: 8, dex: 10, con: 12, int: 13, wis: 14, cha: 15 }),
    ).toBe(true)
  })

  it('rejects a duplicate value substituted for a missing one', () => {
    // duplicates 15 instead of using the 8 - not a valid permutation of the array
    expect(
      validateStandardArrayAssignment({ str: 15, dex: 15, con: 13, int: 12, wis: 10, cha: 14 }),
    ).toBe(false)
  })

  it('rejects scores outside the standard array', () => {
    expect(
      validateStandardArrayAssignment({ str: 16, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }),
    ).toBe(false)
  })
})

describe('validatePointBuy', () => {
  it('accepts a spend within the 27-point budget', () => {
    const result = validatePointBuy({ str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 })
    expect(result.valid).toBe(true)
    expect(result.totalCost).toBe(27)
  })

  it('rejects an illegal overspend', () => {
    const result = validatePointBuy({ str: 15, dex: 15, con: 15, int: 15, wis: 8, cha: 8 })
    expect(result.valid).toBe(false)
    expect(result.totalCost).toBe(36) // 9*4 for the four 15s, 0+0 for the two 8s
    expect(result.errors.length).toBeGreaterThan(0)
  })

  it('rejects a score below the 8-15 range', () => {
    const result = validatePointBuy({ str: 7, dex: 14, con: 13, int: 12, wis: 10, cha: 10 })
    expect(result.valid).toBe(false)
  })

  it('rejects a score above the 8-15 range', () => {
    const result = validatePointBuy({ str: 16, dex: 8, con: 8, int: 8, wis: 8, cha: 8 })
    expect(result.valid).toBe(false)
  })
})

describe('validateAbilityBonusAssignment', () => {
  const eligible = ['str', 'dex', 'con'] as const

  it('accepts a +2/+1 split across two eligible abilities', () => {
    const result = validateAbilityBonusAssignment({ str: 2, con: 1 }, eligible)
    expect(result.valid).toBe(true)
  })

  it('accepts a +1/+1/+1 split across all three eligible abilities', () => {
    const result = validateAbilityBonusAssignment({ str: 1, dex: 1, con: 1 }, eligible)
    expect(result.valid).toBe(true)
  })

  it('rejects assigning a bonus to an ability outside the eligible set', () => {
    const result = validateAbilityBonusAssignment({ str: 2, int: 1 }, eligible)
    expect(result.valid).toBe(false)
  })

  it('rejects a +2/+2 split', () => {
    const result = validateAbilityBonusAssignment({ str: 2, con: 2 }, eligible)
    expect(result.valid).toBe(false)
  })

  it('rejects a +3 dumped into one ability', () => {
    const result = validateAbilityBonusAssignment({ str: 3 }, eligible)
    expect(result.valid).toBe(false)
  })
})
