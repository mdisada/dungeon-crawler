import { describe, expect, it } from 'vitest'

import { validatePredicate } from '@rules/guide'

import { fromPredicate, toPredicate } from './predicate-builder'

// F04 SS7: "Predicate builder round-trips to valid predicate JSON."
const SPEC_EXAMPLE = {
  any: [
    { fact: 'npc.volgarth.status', in: ['dead', 'captured', 'fled', 'allied'] },
    { flag: 'volgarth_ritual_stopped', eq: true },
  ],
}

describe('predicate builder round-trip', () => {
  it('spec example -> builder tree -> identical predicate JSON', () => {
    const rebuilt = toPredicate(fromPredicate(SPEC_EXAMPLE))
    expect(rebuilt).toEqual(SPEC_EXAMPLE)
    expect(validatePredicate(rebuilt)).toEqual([])
  })

  it('round-trips nested combinators and every atom kind', () => {
    const predicate = {
      all: [
        { event: 'party entered the Sunken Chapel' },
        { fact: 'party.reputation', eq: 3 },
        { any: [{ flag: 'bell_silenced', eq: true }, { fact: 'npc.brine.status', eq: 'allied' }] },
      ],
    }
    expect(toPredicate(fromPredicate(predicate))).toEqual(predicate)
  })

  it('always produces valid predicates from builder edits', () => {
    const node = fromPredicate(null) // empty atom fallback
    if (node.kind === 'flag') node.flag = 'my_flag'
    const built = toPredicate(node)
    expect(validatePredicate(built)).toEqual([])
  })
})
