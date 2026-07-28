import { describe, expect, it } from 'vitest'

import { deriveLoreReveals, normalizeLoreName } from './lore-reveals.ts'

const objectives = [
  { id: 'o0', index: 0, title: 'Find the missing fishermen', hiddenDescription: 'The party learns the tide-ledger records ships that never sailed.' },
  { id: 'o1', index: 1, title: 'Cross-reference the entries', hiddenDescription: 'They uncover the Drowned Accord and what it costs.' },
  { id: 'o2', index: 2, title: 'Break the pact', hiddenDescription: 'The finale at the harbour mouth.' },
]

describe('normalizeLoreName', () => {
  it('folds case, punctuation and the leading article', () => {
    expect(normalizeLoreName('The Tide-Ledger')).toBe(normalizeLoreName('the tide-ledger'))
  })
})

describe('deriveLoreReveals', () => {
  it('attributes each force to the FIRST objective that puts the party in front of it', () => {
    const map = deriveLoreReveals(['the tide-ledger', 'the Drowned Accord'], objectives)
    expect(map.get('o0')).toEqual(['the tide-ledger'])
    expect(map.get('o1')).toEqual(['the Drowned Accord'])
  })

  it('matches across casing and hyphenation - the difference between 58% and 85% resolution', () => {
    const map = deriveLoreReveals(['The Tide-Ledger'], objectives)
    expect(map.get('o0')).toEqual(['The Tide-Ledger'])
  })

  it('LEAVES AN UNRESOLVED FORCE WITHHELD - the safety property', () => {
    // Nothing mentions it, so it appears in no objective's reveal list and the narrator never
    // gets its note. That is exactly f9d4f6b's behaviour, which is what makes an imperfect
    // derivation safe to ship: the gate can only loosen, never leak.
    const map = deriveLoreReveals(['The Vasch Bloodline'], objectives)
    expect([...map.values()].flat()).toEqual([])
  })

  it('ignores needles too short to match on substring alone', () => {
    // "the Reach" normalizes to "reach", which occurs inside ordinary prose.
    const map = deriveLoreReveals(['the Reach'], objectives)
    expect([...map.values()].flat()).toEqual([])
  })

  it('groups several forces revealed by one objective', () => {
    const map = deriveLoreReveals(['the tide-ledger', 'the missing fishermen'], objectives)
    expect(map.get('o0')).toEqual(['the tide-ledger', 'the missing fishermen'])
  })
})
