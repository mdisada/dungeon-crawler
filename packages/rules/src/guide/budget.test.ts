import { describe, expect, it } from 'vitest'

import {
  crToXp,
  encounterMultiplier,
  expectedPartyLevel,
  expectedPartySize,
  partyXpBudget,
  validateEncounterBudget,
} from './budget.ts'

describe('budget engine', () => {
  it('maps CR strings to SRD XP values', () => {
    expect(crToXp('1/8')).toBe(25)
    expect(crToXp('1/2')).toBe(100)
    expect(crToXp('5')).toBe(1800)
    expect(crToXp('banana')).toBeNull()
  })

  it('applies DMG encounter-size multipliers', () => {
    expect(encounterMultiplier(1)).toBe(1)
    expect(encounterMultiplier(2)).toBe(1.5)
    expect(encounterMultiplier(6)).toBe(2)
    expect(encounterMultiplier(10)).toBe(2.5)
    expect(encounterMultiplier(15)).toBe(4)
  })

  it('computes party budgets from level thresholds', () => {
    expect(partyXpBudget(1, 4, 'standard')).toBe(200)
    expect(partyXpBudget(3, 4, 'deadly')).toBe(1600)
    expect(partyXpBudget(20, 1, 'easy')).toBe(2800)
  })

  it('verdicts under/within/over with the 60-140% band', () => {
    const party = { level: 1, size: 4 } // standard budget: 200 XP
    expect(validateEncounterBudget([{ cr: '0', count: 1 }], party.level, party.size, 'standard').verdict).toBe('under')
    expect(validateEncounterBudget([{ cr: '1/4', count: 2 }], party.level, party.size, 'standard').verdict).toBe(
      'within', // 100 raw x1.5 = 150
    )
    expect(validateEncounterBudget([{ cr: '2', count: 2 }], party.level, party.size, 'standard').verdict).toBe('over')
  })

  it('collects unknown CRs instead of crashing', () => {
    const result = validateEncounterBudget([{ cr: '1/3', count: 2 }, { cr: '1', count: 1 }], 1, 4, 'standard')
    expect(result.unknownCrs).toEqual(['1/3'])
    expect(result.rawXp).toBe(200)
  })

  it('derives guide-time party assumptions', () => {
    expect(expectedPartyLevel({ type: 'one_shot' }, 0)).toBe(3)
    expect(expectedPartyLevel({ type: 'multi_chapter' }, 0)).toBe(1)
    expect(expectedPartyLevel({ type: 'multi_chapter' }, 5)).toBe(6)
    expect(expectedPartySize({ minPlayers: 2, maxPlayers: 5 })).toBe(4)
    expect(expectedPartySize({ minPlayers: 1, maxPlayers: 1 })).toBe(1)
  })
})
