import { describe, expect, it } from 'vitest'

import { challengeStatus, escalatedDc, majorityContributed, newSkillChallenge, recordAttempt } from './skill-challenge.ts'
import type { SkillChallengeState } from './skill-challenge.ts'

const seed = (overrides?: Partial<SkillChallengeState>): SkillChallengeState => ({
  ...newSkillChallenge({
    neededSuccesses: 3,
    maxFailures: 3,
    suggestedSkills: ['athletics', 'survival'],
    activePcIds: ['a', 'b'],
  }),
  ...overrides,
})

describe('newSkillChallenge', () => {
  it('clamps counts to sane bounds', () => {
    const s = newSkillChallenge({ neededSuccesses: 0, maxFailures: 99, suggestedSkills: [], activePcIds: [] })
    expect(s.neededSuccesses).toBe(1)
    expect(s.maxFailures).toBe(10)
  })
})

describe('recordAttempt counting', () => {
  it('tracks successes, failures, per-skill uses, and per-PC contributions', () => {
    let { state } = recordAttempt(seed(), 'a', 'Athletics', true)
    ;({ state } = recordAttempt(state, 'b', 'athletics', false))
    expect(state.successes).toBe(1)
    expect(state.failures).toBe(1)
    expect(state.perSkillUses).toEqual({ athletics: 2 })
    expect(state.contributions).toEqual({ a: 1, b: 1 })
  })

  it('stays ongoing before either edge', () => {
    const { status } = recordAttempt(seed(), 'a', 'athletics', true)
    expect(status).toBe('ongoing')
  })
})

describe('terminal tiers', () => {
  it('failed once failures reach maxFailures', () => {
    let out = recordAttempt(seed(), 'a', 'athletics', false)
    out = recordAttempt(out.state, 'a', 'athletics', false)
    out = recordAttempt(out.state, 'b', 'survival', false)
    expect(out.status).toBe('failed')
  })

  it('full when everyone contributed and the party is clear of the failure edge', () => {
    let out = recordAttempt(seed(), 'a', 'athletics', true)
    out = recordAttempt(out.state, 'b', 'survival', true)
    out = recordAttempt(out.state, 'a', 'perception', true)
    expect(out.status).toBe('full')
  })

  it('full still allows failures as long as the edge is not reached', () => {
    // maxFailures 3: one failure leaves failures at 1, edge is 2.
    let out = recordAttempt(seed(), 'a', 'athletics', false)
    out = recordAttempt(out.state, 'a', 'survival', true)
    out = recordAttempt(out.state, 'b', 'perception', true)
    out = recordAttempt(out.state, 'b', 'stealth', true)
    expect(out.status).toBe('full')
  })

  // Pass or fail from 2026-07-27 - there is no middle tier. `partial` used to fire on both of the
  // cases below; it credited nothing and routed the party onward as though they had lost.

  it('one PC carrying the whole challenge still passes it', () => {
    // Regression: gating resolution on participation blocked the scene forever, because a party
    // that keeps SUCCEEDING never accumulates the failures that were the only way out of the hold.
    // Live in the $0 suite - a solo PC passed a 1-success challenge four times over, the scene
    // refused to close, and the encounter it had interrupted was never restored.
    let out = recordAttempt(seed(), 'a', 'athletics', true)
    out = recordAttempt(out.state, 'a', 'survival', true)
    out = recordAttempt(out.state, 'a', 'perception', true)
    expect(out.status).toBe('full')
  })

  it('overshooting the requirement never leaves a challenge open', () => {
    const s = newSkillChallenge({
      neededSuccesses: 1, maxFailures: 2, suggestedSkills: [], activePcIds: ['a', 'b'],
    })
    let out = recordAttempt(s, 'a', 'athletics', true)
    for (let i = 0; i < 3; i++) {
      out = recordAttempt(out.state, 'a', 'athletics', true)
      expect(out.status).toBe('full')
    }
  })

  it('scraping through at the failure edge is a clean pass', () => {
    // failures === maxFailures - 1 === 2 when the final success lands. Winning by a hair is
    // winning; the cost belongs in the fiction, not in a tier that credits nothing.
    let out = recordAttempt(seed(), 'a', 'athletics', false)
    out = recordAttempt(out.state, 'b', 'survival', false)
    out = recordAttempt(out.state, 'a', 'perception', true)
    out = recordAttempt(out.state, 'b', 'stealth', true)
    out = recordAttempt(out.state, 'a', 'arcana', true)
    expect(out.status).toBe('full')
  })

  it('reports majority participation without gating on it', () => {
    // Kept for the Variety Manager and narration ("only one of you pitched in"), deliberately not
    // wired into challengeStatus. At-least-half, matching groupOutcome: 1 of 2, 2 of 3, 2 of 4.
    const s = newSkillChallenge({
      neededSuccesses: 2, maxFailures: 3, suggestedSkills: [], activePcIds: ['a', 'b', 'c'],
    })
    let out = recordAttempt(s, 'a', 'athletics', true)
    expect(majorityContributed(out.state)).toBe(false)
    out = recordAttempt(out.state, 'b', 'survival', true)
    expect(majorityContributed(out.state)).toBe(true)
    expect(out.status).toBe('full')
  })

  it('at-least-half matches the SRD group-check standard for a duo', () => {
    const s = newSkillChallenge({
      neededSuccesses: 1, maxFailures: 2, suggestedSkills: [], activePcIds: ['a', 'b'],
    })
    const out = recordAttempt(s, 'a', 'athletics', true)
    expect(majorityContributed(out.state)).toBe(true)
  })

  it('never returns partial for any sequence of attempts', () => {
    let out = recordAttempt(seed(), 'a', 'athletics', true)
    for (const [pc, ok] of [['b', false], ['a', true], ['b', true], ['a', false]] as const) {
      out = recordAttempt(out.state, pc, 'skill', ok)
      expect(['ongoing', 'full', 'failed']).toContain(out.status)
    }
  })

  it('a clean run is never "at the edge" even when maxFailures is 1', () => {
    const s = seed({ neededSuccesses: 2, maxFailures: 1 })
    let out = recordAttempt(s, 'a', 'athletics', true)
    out = recordAttempt(out.state, 'b', 'survival', true)
    expect(out.status).toBe('full')
  })

  it('a solo roster reaches full on its own', () => {
    const s = { ...newSkillChallenge({ neededSuccesses: 2, maxFailures: 2, suggestedSkills: [], activePcIds: ['solo'] }) }
    let out = recordAttempt(s, 'solo', 'athletics', true)
    out = recordAttempt(out.state, 'solo', 'survival', true)
    expect(out.status).toBe('full')
  })

  it('an empty roster (no active PCs recorded) counts as full participation', () => {
    const s = newSkillChallenge({ neededSuccesses: 1, maxFailures: 2, suggestedSkills: [], activePcIds: [] })
    const out = recordAttempt(s, 'ghost', 'athletics', true)
    expect(out.status).toBe('full')
  })
})

describe('escalatedDc', () => {
  it('adds +2 per prior use of the same skill', () => {
    expect(escalatedDc(12, 0)).toBe(12)
    expect(escalatedDc(12, 1)).toBe(14)
    expect(escalatedDc(12, 3)).toBe(18)
  })

  it('never lowers the DC on nonsense input', () => {
    expect(escalatedDc(12, -2)).toBe(12)
  })
})

describe('challengeStatus', () => {
  it('failure wins when both edges are crossed in the same reading', () => {
    const s = seed({ successes: 3, failures: 3 })
    expect(challengeStatus(s)).toBe('failed')
  })
})
