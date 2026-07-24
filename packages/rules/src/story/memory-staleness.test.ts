import { describe, expect, it } from 'vitest'

import { annotateStaleMemories } from './memory-staleness'
import type { MemorySubject } from './memory-staleness'

const subjects: MemorySubject[] = [
  { name: 'Elias Thorne', state: 'dead' },
  { name: 'Keeper Elphin', state: 'absent' },
  { name: 'Sereth Vane', state: 'alive' },
]

describe('annotateStaleMemories', () => {
  it('repairs the tense of a memory about someone since dead', () => {
    const [out] = annotateStaleMemories(['Elias Thorne begs you to escort him.'], subjects)
    expect(out).toBe('Elias Thorne begs you to escort him. (since then: Elias Thorne has since died)')
  })

  it('annotates rather than drops - the memory really did happen', () => {
    const [out] = annotateStaleMemories(['Elias Thorne handed over the ledger.'], subjects)
    expect(out).toContain('Elias Thorne handed over the ledger.')
  })

  it('says the right thing about someone merely absent', () => {
    const [out] = annotateStaleMemories(['Keeper Elphin promised to meet you.'], subjects)
    expect(out).toContain('has since left the scene')
  })

  it('leaves memories about the living completely alone', () => {
    const input = ['Sereth Vane sharpened her blade and said nothing.']
    expect(annotateStaleMemories(input, subjects)).toEqual(input)
  })

  it('leaves memories naming nobody alone', () => {
    const input = ['The storm broke over the harbour that night.']
    expect(annotateStaleMemories(input, subjects)).toEqual(input)
  })

  it('handles a memory naming two people who have both moved on', () => {
    const [out] = annotateStaleMemories(['Elias Thorne argued with Keeper Elphin.'], subjects)
    expect(out).toContain('Elias Thorne has since died')
    expect(out).toContain('Keeper Elphin has since left the scene')
  })

  it('is a no-op when nobody is dead or absent', () => {
    const input = ['Elias Thorne begs you to escort him.']
    expect(annotateStaleMemories(input, [{ name: 'Elias Thorne', state: 'alive' }])).toEqual(input)
  })

  it('matches whole names only', () => {
    const input = ['The thornewood grows thick here.']
    expect(annotateStaleMemories(input, subjects)).toEqual(input)
  })

  it('preserves order and count', () => {
    const input = ['a', 'Elias Thorne fell', 'b']
    const out = annotateStaleMemories(input, subjects)
    expect(out).toHaveLength(3)
    expect(out[0]).toBe('a')
    expect(out[2]).toBe('b')
  })
})
