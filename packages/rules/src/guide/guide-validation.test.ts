import { describe, expect, it } from 'vitest'

import { validateGuideReady } from './guide-validation.ts'

const VALID_PREDICATE = { flag: 'done', eq: true }

describe('validateGuideReady (Start Adventure)', () => {
  it('passes a minimal valid guide', () => {
    const errors = validateGuideReady({
      chapters: [{ title: 'Ch 1', objectives: [{ title: 'Do it', completionPredicates: VALID_PREDICATE }] }],
      locationCount: 1,
      endingCount: 2,
    })
    expect(errors).toEqual([])
  })

  it('catches chapters without objectives', () => {
    const errors = validateGuideReady({
      chapters: [
        { title: 'Ch 1', objectives: [{ title: 'Do it', completionPredicates: VALID_PREDICATE }] },
        { title: 'Ch 2', objectives: [] },
      ],
      locationCount: 1,
      endingCount: 3,
    })
    expect(errors).toEqual(['Ch 2 has no objectives.'])
  })

  it('catches missing and invalid predicates (F04 SS7: validation catches missing predicates)', () => {
    const errors = validateGuideReady({
      chapters: [
        {
          title: 'Ch 1',
          objectives: [
            { title: 'No predicate', completionPredicates: null },
            { title: 'Bad predicate', completionPredicates: { whenever: true } },
          ],
        },
      ],
      locationCount: 1,
      endingCount: 2,
    })
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('No predicate')
    expect(errors[1]).toContain('Bad predicate')
  })

  it('requires at least one location, one chapter, and two endings (F04 SS4.2)', () => {
    expect(validateGuideReady({ chapters: [], locationCount: 0, endingCount: 1 })).toEqual([
      'The guide has no chapters.',
      'The guide needs at least one location.',
      'The guide needs at least two candidate endings.',
    ])
  })
})
