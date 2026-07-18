import { describe, expect, it } from 'vitest'

import {
  applyAssist, clampDc, DC_MAX, DC_MIN, groupOutcome, promptDeadline, promptExpired,
  rollCheck, SOCIAL_DC, socialDc,
} from './checks.ts'
import { seededRng } from './rng.ts'

describe('clampDc', () => {
  it('clamps below the floor and above the ceiling', () => {
    expect(clampDc(1)).toBe(DC_MIN)
    expect(clampDc(40)).toBe(DC_MAX)
    expect(clampDc(-3)).toBe(DC_MIN)
  })

  it('rounds and passes in-range values through', () => {
    expect(clampDc(12)).toBe(12)
    expect(clampDc(14.6)).toBe(15)
  })

  it('degrades NaN/Infinity to the floor', () => {
    expect(clampDc(Number.NaN)).toBe(DC_MIN)
    expect(clampDc(Number.POSITIVE_INFINITY)).toBe(DC_MAX)
    expect(clampDc(Number.NEGATIVE_INFINITY)).toBe(DC_MIN)
  })
})

describe('socialDc', () => {
  it('uses the bounded table', () => {
    expect(socialDc('trivial', 0)).toBe(SOCIAL_DC.trivial)
    expect(socialDc('reasonable', 0)).toBe(12)
    expect(socialDc('costly', 0)).toBe(16)
    expect(socialDc('against_nature', 0)).toBe(20)
  })

  it('applies the +-2 disposition adjust', () => {
    expect(socialDc('reasonable', 4)).toBe(10) // friendly eases
    expect(socialDc('reasonable', -5)).toBe(14) // unfriendly hardens
    expect(socialDc('reasonable', 1)).toBe(12) // neutral band unchanged
  })
})

describe('rollCheck', () => {
  it('is deterministic under a seed', () => {
    const a = rollCheck(seededRng(42), 3, 12, 'none')
    const b = rollCheck(seededRng(42), 3, 12, 'none')
    expect(a).toEqual(b)
    expect(a.rolls).toHaveLength(1)
    expect(a.total).toBe(a.d20 + 3)
    expect(a.success).toBe(a.total >= 12)
    expect(a.margin).toBe(a.total - 12)
  })

  it('advantage takes the higher of two dice, disadvantage the lower', () => {
    for (let seed = 0; seed < 50; seed++) {
      const adv = rollCheck(seededRng(seed), 0, 10, 'advantage')
      expect(adv.rolls).toHaveLength(2)
      expect(adv.d20).toBe(Math.max(...adv.rolls))
      const dis = rollCheck(seededRng(seed), 0, 10, 'disadvantage')
      expect(dis.d20).toBe(Math.min(...dis.rolls))
    }
  })

  it('stays within d20 bounds across many seeds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const r = rollCheck(seededRng(seed), 0, 10, 'none')
      expect(r.d20).toBeGreaterThanOrEqual(1)
      expect(r.d20).toBeLessThanOrEqual(20)
    }
  })
})

describe('groupOutcome', () => {
  const pass = { success: true }
  const fail = { success: false }

  it('succeeds when at least half pass (SRD rule)', () => {
    expect(groupOutcome([pass, fail]).success).toBe(true)
    expect(groupOutcome([pass, pass, fail, fail]).success).toBe(true)
    expect(groupOutcome([pass, fail, fail]).success).toBe(false)
    expect(groupOutcome([pass, pass, fail]).success).toBe(true)
  })

  it('needs a majority threshold of ceil(n/2)', () => {
    expect(groupOutcome([pass, fail, fail, fail, fail]).needed).toBe(3)
    expect(groupOutcome([pass, fail]).needed).toBe(1)
  })

  it('an empty group never succeeds', () => {
    expect(groupOutcome([]).success).toBe(false)
  })
})

describe('applyAssist', () => {
  const success = rollCheck(seededRng(7), 20, 5, 'none') // guaranteed pass with +20
  const failure = rollCheck(seededRng(7), -20, 25, 'none') // guaranteed fail with -20

  it('enable gates the primary attempt on assist success', () => {
    expect(applyAssist('enable', success)).toEqual({ mayAttempt: true, primaryAdvDis: 'none' })
    expect(applyAssist('enable', failure).mayAttempt).toBe(false)
    expect(applyAssist('enable', null).mayAttempt).toBe(false)
  })

  it('bonus grants advantage on assist success, nothing otherwise', () => {
    expect(applyAssist('bonus', success)).toEqual({ mayAttempt: true, primaryAdvDis: 'advantage' })
    expect(applyAssist('bonus', failure)).toEqual({ mayAttempt: true, primaryAdvDis: 'none' })
    expect(applyAssist('bonus', null)).toEqual({ mayAttempt: true, primaryAdvDis: 'none' })
  })
})

describe('prompt windows', () => {
  it('deadline math round-trips with expiry', () => {
    const now = new Date('2026-07-18T12:00:00Z')
    const deadline = promptDeadline(now, 20)
    expect(promptExpired(deadline, new Date('2026-07-18T12:00:19Z'))).toBe(false)
    expect(promptExpired(deadline, new Date('2026-07-18T12:00:20Z'))).toBe(true)
  })
})
