import { describe, expect, it } from 'vitest'

import { evaluatePredicate, listMilestoneAtoms } from './evaluate.ts'
import type { WorldFacts } from './evaluate.ts'

const world: WorldFacts = {
  facts: { 'npc.volgarth.status': 'dead', boy_found: true },
  flags: { ritual_stopped: true },
  events: new Set(['party entered the mill cellar']),
}

describe('evaluatePredicate (deterministic, F08 SS9)', () => {
  it('fact eq and in atoms', () => {
    expect(evaluatePredicate({ fact: 'boy_found', eq: true }, world)).toBe(true)
    expect(evaluatePredicate({ fact: 'npc.volgarth.status', in: ['dead', 'fled'] }, world)).toBe(true)
    expect(evaluatePredicate({ fact: 'npc.volgarth.status', eq: 'alive' }, world)).toBe(false)
  })

  it('unknown facts never hold (ambiguity goes to the Adjudicator, not to true)', () => {
    expect(evaluatePredicate({ fact: 'never_written', eq: true }, world)).toBe(false)
  })

  it('listMilestoneAtoms: eq-true flags/facts + events, nested, deduped; scalar facts excluded', () => {
    const predicate = {
      any: [
        { all: [{ flag: 'lantern_relit', eq: true }, { event: 'keeper freed' }] },
        { flag: 'lantern_relit', eq: true },
        { flag: 'town_doomed', eq: false },
        { fact: 'npc.volgarth.status', eq: 'dead' },
        { fact: 'party_reached_archipelago', eq: true },
        { fact: 'npc.hemlock.status', in: ['talked_to', 'dead'] },
        { event: 'wreckers routed' },
      ],
    }
    expect(listMilestoneAtoms(predicate)).toEqual({
      flags: ['lantern_relit'],
      events: ['keeper freed', 'wreckers routed'],
      facts: ['party_reached_archipelago'],
    })
    expect(listMilestoneAtoms(null)).toEqual({ flags: [], events: [], facts: [] })
  })

  it('flag and event atoms', () => {
    expect(evaluatePredicate({ flag: 'ritual_stopped', eq: true }, world)).toBe(true)
    expect(evaluatePredicate({ flag: 'ritual_stopped', eq: false }, world)).toBe(false)
    expect(evaluatePredicate({ event: 'party entered the mill cellar' }, world)).toBe(true)
    expect(evaluatePredicate({ event: 'party met the king' }, world)).toBe(false)
  })

  it('any/all combinators', () => {
    expect(evaluatePredicate({ any: [{ fact: 'nope', eq: 1 }, { flag: 'ritual_stopped', eq: true }] }, world)).toBe(true)
    expect(evaluatePredicate({ all: [{ fact: 'boy_found', eq: true }, { fact: 'nope', eq: 1 }] }, world)).toBe(false)
  })

  it('invalid predicates evaluate false, never throw', () => {
    expect(evaluatePredicate({ whenever: true }, world)).toBe(false)
    expect(evaluatePredicate(null, world)).toBe(false)
  })
})

describe('an unset flag reads as false (2026-07-23)', () => {
  const world = { facts: {}, flags: {}, events: new Set<string>() }

  it('satisfies a "has not happened yet" clause', () => {
    expect(evaluatePredicate({ flag: 'eight_days_passed', eq: false }, world)).toBe(true)
  })

  it('THE Reach Oakhaven predicate: completable once the positive half is awarded', () => {
    // Live 2026-07-23 - this objective was still active when the run ended, because nothing
    // writes a flag false and the negative half could therefore never hold.
    const predicate = {
      all: [{ flag: 'elara_reached_oakhaven', eq: true }, { flag: 'eight_days_passed', eq: false }],
    }
    expect(evaluatePredicate(predicate, world)).toBe(false)
    expect(evaluatePredicate(predicate, {
      ...world, flags: { elara_reached_oakhaven: true },
    })).toBe(true)
  })

  it('still fails once the deadline actually passes', () => {
    expect(evaluatePredicate({
      all: [{ flag: 'elara_reached_oakhaven', eq: true }, { flag: 'eight_days_passed', eq: false }],
    }, { ...world, flags: { elara_reached_oakhaven: true, eight_days_passed: true } })).toBe(false)
  })

  it('absence satisfies only eq:false - never true, a string, or a number', () => {
    expect(evaluatePredicate({ flag: 'never_set', eq: true }, world)).toBe(false)
    expect(evaluatePredicate({ fact: 'npc.x.status', eq: 'dead' }, world)).toBe(false)
    expect(evaluatePredicate({ fact: 'count', eq: 0 }, world)).toBe(false)
    expect(evaluatePredicate({ fact: 'gone', eq: false }, world)).toBe(true)
  })

  it('an unset fact matches no `in` list', () => {
    expect(evaluatePredicate({ fact: 'npc.x.status', in: ['dead', 'absent'] }, world)).toBe(false)
  })
})
