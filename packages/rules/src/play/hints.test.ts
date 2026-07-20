import { describe, expect, it } from 'vitest'

import { decideHint } from './hints.ts'

const base = { turnsThreshold: 3, allowFailForward: true }

describe('decideHint - auto detector', () => {
  it('stays silent before the threshold', () => {
    expect(decideHint({ ...base, noProgressTurns: 2, hintsSinceProgress: 0, requested: false }).rung).toBeNull()
  })

  it('fires rung 1 at the threshold', () => {
    expect(decideHint({ ...base, noProgressTurns: 3, hintsSinceProgress: 0, requested: false }).rung).toBe(1)
  })

  it('holds at rung 1 until the streak grows (conservative escalation)', () => {
    // one hint already given; at turn 4 the next rung isn't unlocked yet.
    expect(decideHint({ ...base, noProgressTurns: 4, hintsSinceProgress: 1, requested: false }).rung).toBeNull()
    // turn 5 unlocks rung 2.
    expect(decideHint({ ...base, noProgressTurns: 5, hintsSinceProgress: 1, requested: false }).rung).toBe(2)
  })

  it('climbs one rung per two extra no-progress turns up to fail-forward', () => {
    // threshold 3: rung 2 at turn 5, rung 3 at turn 7, rung 4 at turn 9.
    expect(decideHint({ ...base, noProgressTurns: 7, hintsSinceProgress: 2, requested: false }).rung).toBe(3)
    expect(decideHint({ ...base, noProgressTurns: 9, hintsSinceProgress: 3, requested: false }).rung).toBe(4)
    // between unlocks it holds rather than repeating.
    expect(decideHint({ ...base, noProgressTurns: 6, hintsSinceProgress: 2, requested: false }).rung).toBeNull()
  })

  it('respects a DM-raised threshold', () => {
    expect(decideHint({ ...base, turnsThreshold: 5, noProgressTurns: 4, hintsSinceProgress: 0, requested: false }).rung).toBeNull()
    expect(decideHint({ ...base, turnsThreshold: 5, noProgressTurns: 5, hintsSinceProgress: 0, requested: false }).rung).toBe(1)
  })
})

describe('decideHint - player requested', () => {
  it('always lands, even below the threshold', () => {
    expect(decideHint({ ...base, noProgressTurns: 0, hintsSinceProgress: 0, requested: true }).rung).toBe(1)
  })

  it('climbs the ladder immediately on repeat asks', () => {
    expect(decideHint({ ...base, noProgressTurns: 0, hintsSinceProgress: 1, requested: true }).rung).toBe(2)
    expect(decideHint({ ...base, noProgressTurns: 0, hintsSinceProgress: 3, requested: true }).rung).toBe(4)
  })

  it('caps at rung 4', () => {
    expect(decideHint({ ...base, noProgressTurns: 0, hintsSinceProgress: 9, requested: true }).rung).toBe(4)
  })
})

describe('decideHint - fail-forward gating', () => {
  it('downshifts rung 4 to 3 when fail-forward is disallowed (assist)', () => {
    expect(decideHint({ turnsThreshold: 3, allowFailForward: false, noProgressTurns: 0, hintsSinceProgress: 3, requested: true }).rung).toBe(3)
  })
})
