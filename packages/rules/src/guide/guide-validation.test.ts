import { describe, expect, it } from 'vitest'

import { validateGuideReady } from './guide-validation.ts'
import type { GuideForValidation } from './guide-validation.ts'

const VALID_PREDICATE = { flag: 'done', eq: true }

const baseGuide = (over: Partial<GuideForValidation> = {}): GuideForValidation => ({
  chapters: [{ title: 'Ch 1', objectives: [{ title: 'Do it', completionPredicates: VALID_PREDICATE }] }],
  locationCount: 1,
  endingCount: 2,
  contracts: [{
    label: 'Escort Maren', isEntry: true, giverNpcId: 'npc-1',
    goldFloor: 50, goldCeiling: 100, objectiveIds: ['obj-1'],
  }],
  npcIds: ['npc-1'],
  objectiveIds: ['obj-1'],
  ...over,
})

describe('validateGuideReady (Start Adventure)', () => {
  it('passes a minimal valid guide', () => {
    expect(validateGuideReady(baseGuide())).toEqual([])
  })

  it('catches chapters without objectives', () => {
    const errors = validateGuideReady(baseGuide({
      chapters: [
        { title: 'Ch 1', objectives: [{ title: 'Do it', completionPredicates: VALID_PREDICATE }] },
        { title: 'Ch 2', objectives: [] },
      ],
      endingCount: 3,
    }))
    expect(errors).toEqual(['Ch 2 has no objectives.'])
  })

  it('catches missing and invalid predicates (F04 SS7: validation catches missing predicates)', () => {
    const errors = validateGuideReady(baseGuide({
      chapters: [
        {
          title: 'Ch 1',
          objectives: [
            { title: 'No predicate', completionPredicates: null },
            { title: 'Bad predicate', completionPredicates: { whenever: true } },
          ],
        },
      ],
    }))
    expect(errors).toHaveLength(2)
    expect(errors[0]).toContain('No predicate')
    expect(errors[1]).toContain('Bad predicate')
  })

  it('requires at least one location, one chapter, and two endings (F04 SS4.2)', () => {
    const errors = validateGuideReady(baseGuide({ chapters: [], locationCount: 0, endingCount: 1 }))
    expect(errors).toContain('The guide has no chapters.')
    expect(errors).toContain('The guide needs at least one location.')
    expect(errors).toContain('The guide needs at least two candidate endings.')
  })

  it('requires exactly one entry contract (F04 SS4.3)', () => {
    expect(validateGuideReady(baseGuide({ contracts: [] }))).toEqual([
      'The guide needs exactly one entry quest contract (the opening offer).',
    ])
    const doubled = baseGuide()
    doubled.contracts = [...doubled.contracts, { ...doubled.contracts[0], label: 'Second entry' }]
    expect(validateGuideReady(doubled)).toContain(
      'The guide needs exactly one entry quest contract (the opening offer).',
    )
  })

  it('requires a one-shot to author a full three-act ladder', () => {
    const twoObjectives = baseGuide({
      adventureType: 'one_shot',
      chapters: [{
        title: 'One night',
        objectives: [
          { title: 'Identify the suspects', completionPredicates: VALID_PREDICATE },
          { title: 'Search the chambers', completionPredicates: VALID_PREDICATE },
        ],
      }],
    })
    expect(validateGuideReady(twoObjectives)).toEqual([
      'A one-shot needs at least 3 objectives ending in a climax - this one has 2.',
    ])
    // Multi-chapter guides keep the old rule.
    expect(validateGuideReady({ ...twoObjectives, adventureType: 'multi_chapter' })).toEqual([])
  })

  it('rejects endings no objective can reach', () => {
    const errors = validateGuideReady(baseGuide({
      endings: [
        { title: 'Justice done', objectiveIds: ['obj-1'] },
        { title: 'Vibes only', objectiveIds: [] },
        { title: 'Dangling', objectiveIds: ['obj-gone'] },
      ],
    }))
    expect(errors).toEqual([
      '"Vibes only" references no existing objective - nothing the party does can reach it.',
      '"Dangling" references no existing objective - nothing the party does can reach it.',
    ])
  })

  it('catches a dangling giver, inverted reward, and dangling objective refs', () => {
    const errors = validateGuideReady(baseGuide({
      contracts: [{
        label: 'Broken deal', isEntry: true, giverNpcId: 'npc-gone',
        goldFloor: 100, goldCeiling: 50, objectiveIds: ['obj-gone'],
      }],
    }))
    expect(errors).toEqual([
      'Broken deal: the giver must be an existing NPC.',
      'Broken deal: reward ceiling is below the floor.',
      'Broken deal: must cover at least one existing objective.',
    ])
  })
})
