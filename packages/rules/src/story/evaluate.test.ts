import { describe, expect, it } from 'vitest'

import { evaluatePredicate } from './evaluate.ts'
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
