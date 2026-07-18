import { describe, expect, it } from 'vitest'

import { parseDice, rollDice } from './dice'

describe('parseDice', () => {
  it('parses NdM+K, bare dM, and negative modifiers', () => {
    expect(parseDice('2d6+3')).toEqual({ count: 2, sides: 6, modifier: 3 })
    expect(parseDice('d20')).toEqual({ count: 1, sides: 20, modifier: 0 })
    expect(parseDice('4d8 - 2')).toEqual({ count: 4, sides: 8, modifier: -2 })
  })

  it('rejects garbage and out-of-range specs', () => {
    expect(parseDice('banana')).toBeNull()
    expect(parseDice('0d6')).toBeNull()
    expect(parseDice('2d1')).toBeNull()
    expect(parseDice('101d6')).toBeNull()
  })
})

describe('rollDice', () => {
  it('stays inside the algebraic bounds', () => {
    for (let i = 0; i < 50; i++) {
      const roll = rollDice('3d6+2')!
      expect(roll.rolls).toHaveLength(3)
      expect(roll.total).toBeGreaterThanOrEqual(3 + 2)
      expect(roll.total).toBeLessThanOrEqual(18 + 2)
      expect(roll.total).toBe(roll.rolls.reduce((a, b) => a + b, 0) + roll.modifier)
    }
  })

  it('returns null for invalid expressions', () => {
    expect(rollDice('nope')).toBeNull()
  })
})
