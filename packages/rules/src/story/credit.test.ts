import { describe, expect, it } from 'vitest'

import { decideCredit, isObjectiveCreditSource, OBJECTIVE_CREDIT_SOURCES } from './credit'
import { pickReveal } from './reveals'

const credit = (source: string, isObjectiveAtom = true, enforced = true) =>
  decideCredit({ source, isObjectiveAtom, enforced })

describe('objective credit gate', () => {
  it('lets an authored outcome map complete an objective', () => {
    expect(credit('encounter_outcome').apply).toBe(true)
  })

  it('lets the recognition judge complete an objective', () => {
    // It demands a verbatim evidence quote about the objective's intent - a different act from
    // noticing a verb, and the deliberate path for progress won in fiction.
    expect(credit('objective_judge').apply).toBe(true)
  })

  it('BLOCKS the scene ledger from completing an objective', () => {
    // The live failure: "party examined the flickering lamps" credited because someone glanced
    // at a lamp, completing the objective and paying the party for an untouched mystery.
    const decision = credit('scene_ledger')
    expect(decision.apply).toBe(false)
    if (decision.apply) return
    expect(decision.reason).toContain('outcome maps')
  })

  it('BLOCKS an adjudicator mark_event from completing an objective', () => {
    // "party entered the Drift" completed "Gather proof of Veil's crimes" by walking in.
    expect(credit('adjudicator_mark_event').apply).toBe(false)
    expect(credit('adjudicator').apply).toBe(false)
  })

  it('never gates a BEAT atom - loose sources keep working for colour', () => {
    for (const source of ['scene_ledger', 'adjudicator_mark_event', 'adjudicator']) {
      expect(credit(source, false).apply).toBe(true)
    }
  })

  it('the rollout switch restores pre-gate behaviour exactly', () => {
    expect(credit('scene_ledger', true, false).apply).toBe(true)
  })

  it('an unknown source is treated as loose, not privileged (fail closed)', () => {
    expect(credit('some_future_agent').apply).toBe(false)
  })

  it('exposes exactly the deed sources - and nothing observational', () => {
    // Three since 2026-07-29: `node_established` joined when the plot stopped being the prize for
    // winning an encounter and became what a RESOLVED authored node makes true. The list is
    // asserted whole on purpose - it is the single gate between a real deed and a free objective,
    // and it should not grow by accident.
    expect([...OBJECTIVE_CREDIT_SOURCES]).toEqual([
      'encounter_outcome', 'objective_judge', 'node_established',
    ])
    expect(isObjectiveCreditSource('scene_ledger')).toBe(false)
  })
})

describe('reveal placement', () => {
  const clue = (reveals: string, location_id?: string) => ({
    reveals,
    placement: location_id ? { location_id } : null,
  })

  it('prefers a clue placed where the party actually is', () => {
    const rows = [clue('in the office', 'office'), clue('at the mine', 'mine')]
    expect(pickReveal(rows, 'mine')).toBe('at the mine')
  })

  it('NEVER surfaces a clue bound to somewhere else', () => {
    // The live leak: an office clue narrated as observed fact at the mine entrance.
    expect(pickReveal([clue('in the office', 'office')], 'mine')).toBeNull()
  })

  it('falls back to an unplaced clue, which can surface anywhere', () => {
    const rows = [clue('in the office', 'office'), clue('a rumour on the wind')]
    expect(pickReveal(rows, 'mine')).toBe('a rumour on the wind')
  })

  it('still prefers the local clue over an unplaced one', () => {
    const rows = [clue('a rumour on the wind'), clue('at the mine', 'mine')]
    expect(pickReveal(rows, 'mine')).toBe('at the mine')
  })

  it('with no known location, only unplaced clues are eligible', () => {
    expect(pickReveal([clue('at the mine', 'mine')], null)).toBeNull()
    expect(pickReveal([clue('a rumour')], null)).toBe('a rumour')
  })

  it('ignores blank and null reveals', () => {
    expect(pickReveal([{ reveals: '   ' }, { reveals: null }, clue('real')], null)).toBe('real')
  })

  it('is deterministic - first in table order within the preferred group', () => {
    const rows = [clue('first', 'mine'), clue('second', 'mine')]
    expect(pickReveal(rows, 'mine')).toBe('first')
    expect(pickReveal(rows, 'mine')).toBe(pickReveal(rows, 'mine'))
  })
})

describe('node_established (2026-07-29)', () => {
  // Live in run aa8a4fe3 the whole decoupling was silently inert: every node carried its
  // `establishes` atom, the runtime looked it up correctly, and the spine gate then blocked it -
  // 10 `objective_credit_blocked` events, 3 of them this source. The guide was right, the runtime
  // was right, and one allow-list stood between them.
  it('may complete an objective - a resolved authored node is a deed', () => {
    expect(decideCredit({ source: 'node_established', isObjectiveAtom: true, enforced: true }))
      .toEqual({ apply: true })
  })

  it('does not weaken the gate for observation sources', () => {
    for (const source of ['scene_ledger', 'adjudicator', 'adjudicator_mark_event']) {
      expect(decideCredit({ source, isObjectiveAtom: true, enforced: true }).apply).toBe(false)
    }
  })
})
