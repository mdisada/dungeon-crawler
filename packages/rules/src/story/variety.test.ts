import { describe, expect, it } from 'vitest'

import { computeVarietyFlags, varietyGuidance } from './variety.ts'
import type { VarietyInput } from './variety.ts'

const base = (over: Partial<VarietyInput> = {}): VarietyInput => ({
  completedLoopTypes: [],
  pillarUsage: {},
  coopEventsThisSession: 2,
  coopDemandStreak: 0,
  resolvedIntents: {},
  ...over,
})

describe('computeVarietyFlags (pure counting, F08 SS7)', () => {
  it('flags the same loop type three times in a row', () => {
    expect(computeVarietyFlags(base({ completedLoopTypes: ['mystery', 'mystery', 'mystery'] })).suggestAlternateType).toBe(true)
    expect(computeVarietyFlags(base({ completedLoopTypes: ['mystery', 'heist', 'mystery'] })).suggestAlternateType).toBe(false)
    expect(computeVarietyFlags(base({ completedLoopTypes: ['mystery', 'mystery'] })).suggestAlternateType).toBe(false)
  })

  it('flags a player whose dominant pillar went unused for the recent sessions', () => {
    const flags = computeVarietyFlags(base({
      pillarUsage: {
        ash: { total: { combat: 20, social: 5, exploration: 8 }, recentSessions: { combat: 0, social: 3, exploration: 2 } },
        bryn: { total: { combat: 2, social: 15, exploration: 4 }, recentSessions: { combat: 0, social: 6, exploration: 1 } },
      },
    }))
    expect(flags.pillarStarved).toEqual([{ player: 'ash', pillar: 'combat' }])
  })

  it('coop_low fires on a zero-cooperation session; coop_fatigue on 3 consecutive demands', () => {
    expect(computeVarietyFlags(base({ coopEventsThisSession: 0 })).coopLow).toBe(true)
    expect(computeVarietyFlags(base({ coopDemandStreak: 3 })).coopFatigue).toBe(true)
    expect(computeVarietyFlags(base({ coopDemandStreak: 2 })).coopFatigue).toBe(false)
  })

  it('spotlight fires above 60% share with enough resolved intents, never below the floor', () => {
    expect(computeVarietyFlags(base({ resolvedIntents: { ash: 9, bryn: 3 } })).spotlight).toBe('ash')
    expect(computeVarietyFlags(base({ resolvedIntents: { ash: 5, bryn: 5 } })).spotlight).toBeNull()
    expect(computeVarietyFlags(base({ resolvedIntents: { ash: 5, bryn: 1 } })).spotlight).toBeNull()
  })

  it('guidance lines render only for raised flags (planner input, never a hard constraint)', () => {
    expect(varietyGuidance(computeVarietyFlags(base()))).toEqual([])
    const lines = varietyGuidance(computeVarietyFlags(base({ coopEventsThisSession: 0, coopDemandStreak: 3 })))
    expect(lines.some((l) => l.includes('cooperative'))).toBe(true)
    expect(lines.some((l) => l.includes('NOT demand'))).toBe(true)
  })
})
