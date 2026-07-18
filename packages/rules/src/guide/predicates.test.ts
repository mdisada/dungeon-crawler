import { describe, expect, it } from 'vitest'

import { parsePredicateJson, validatePredicate } from './predicates.ts'

// The exact example from F04 SS4.
const SPEC_EXAMPLE = {
  any: [
    { fact: 'npc.volgarth.status', in: ['dead', 'captured', 'fled', 'allied'] },
    { flag: 'volgarth_ritual_stopped', eq: true },
  ],
}

describe('validatePredicate', () => {
  it('accepts the spec example', () => {
    expect(validatePredicate(SPEC_EXAMPLE)).toEqual([])
  })

  it('accepts each atom form', () => {
    expect(validatePredicate({ fact: 'party.gold', eq: 0 })).toEqual([])
    expect(validatePredicate({ fact: 'npc.x.status', in: ['dead'] })).toEqual([])
    expect(validatePredicate({ flag: 'ritual_stopped', eq: true })).toEqual([])
    expect(validatePredicate({ event: 'party entered the Sunken Chapel' })).toEqual([])
  })

  it('accepts nested combinators', () => {
    const nested = { all: [{ event: 'a' }, { any: [{ flag: 'f', eq: 1 }, { fact: 'p', eq: 'x' }] }] }
    expect(validatePredicate(nested)).toEqual([])
  })

  it('rejects non-objects', () => {
    expect(validatePredicate(null)).toHaveLength(1)
    expect(validatePredicate('fact')).toHaveLength(1)
    expect(validatePredicate([SPEC_EXAMPLE])).toHaveLength(1)
  })

  it('rejects an object with no atom key or two atom keys', () => {
    expect(validatePredicate({})).toHaveLength(1)
    expect(validatePredicate({ fact: 'a', flag: 'b', eq: 1 })[0]).toMatch(/exactly one/)
  })

  it('rejects a fact atom with both or neither of eq/in', () => {
    expect(validatePredicate({ fact: 'a' })).toHaveLength(1)
    expect(validatePredicate({ fact: 'a', eq: 1, in: [1] })).toHaveLength(1)
  })

  it('rejects non-scalar eq values and empty in arrays', () => {
    expect(validatePredicate({ fact: 'a', eq: { nested: true } })).toHaveLength(1)
    expect(validatePredicate({ fact: 'a', in: [] })).toHaveLength(1)
    expect(validatePredicate({ flag: 'f', eq: [1] })).toHaveLength(1)
  })

  it('rejects unknown keys on atoms', () => {
    expect(validatePredicate({ event: 'x', extra: 1 })).toHaveLength(1)
    expect(validatePredicate({ flag: 'f', eq: 1, note: 'hi' })).toHaveLength(1)
  })

  it('rejects empty combinator arrays and reports nested paths', () => {
    expect(validatePredicate({ any: [] })).toHaveLength(1)
    const errors = validatePredicate({ all: [{ fact: 'ok', eq: 1 }, { bogus: true }] })
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain('$.all[1]')
  })
})

describe('parsePredicateJson (editor raw-JSON escape hatch)', () => {
  it('round-trips: builder JSON -> text -> parse -> identical structure', () => {
    const text = JSON.stringify(SPEC_EXAMPLE)
    const result = parsePredicateJson(text)
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.predicate).toEqual(SPEC_EXAMPLE)
      expect(JSON.parse(JSON.stringify(result.predicate))).toEqual(SPEC_EXAMPLE)
    }
  })

  it('blocks syntactically invalid JSON with an explanation', () => {
    const result = parsePredicateJson('{ "fact": ')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/Not valid JSON/)
  })

  it('blocks well-formed JSON that is not a valid predicate', () => {
    const result = parsePredicateJson('{ "sometimes": "maybe" }')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.errors[0]).toMatch(/exactly one of/)
  })
})
