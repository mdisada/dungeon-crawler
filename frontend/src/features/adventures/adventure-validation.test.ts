import { describe, expect, it } from 'vitest'

import { guideRequirementsMissing } from './adventure-validation'
import { emptyPlotHistory } from './plot-history'
import type { AdventureDraft } from './types'

function validDraft(overrides: Partial<AdventureDraft> = {}): AdventureDraft {
  return {
    mode: 'assist',
    minPlayers: 1,
    maxPlayers: 4,
    type: 'one_shot',
    chaptersMin: null,
    chaptersMax: null,
    plotIdea: 'A haunted lighthouse hides a smuggling ring.',
    plotHistory: emptyPlotHistory(),
    difficultyPreset: null,
    ...overrides,
  }
}

describe('guideRequirementsMissing', () => {
  it('passes a complete AI-Assist one-shot draft', () => {
    expect(guideRequirementsMissing(validDraft())).toEqual([])
  })

  it('requires mode, type, and a plot idea', () => {
    const missing = guideRequirementsMissing(validDraft({ mode: null, type: null, plotIdea: '   ' }))
    expect(missing).toContain('Choose a mode')
    expect(missing).toContain('Choose an adventure type')
    expect(missing).toContain('Generate a plot first, or write one')
  })

  it('requires a difficulty for Full-AI mode only', () => {
    expect(guideRequirementsMissing(validDraft({ mode: 'full_ai' }))).toContain('Choose a difficulty')
    expect(
      guideRequirementsMissing(validDraft({ mode: 'full_ai', difficultyPreset: 'standard' })),
    ).toEqual([])
    expect(guideRequirementsMissing(validDraft({ mode: 'assist' }))).toEqual([])
  })

  it('rejects an invalid player range', () => {
    expect(guideRequirementsMissing(validDraft({ minPlayers: 5, maxPlayers: 3 }))).toContain(
      'Set a valid player range',
    )
    expect(guideRequirementsMissing(validDraft({ minPlayers: 0 }))).toContain('Set a valid player range')
    expect(guideRequirementsMissing(validDraft({ maxPlayers: 9 }))).toContain('Set a valid player range')
  })

  it('requires a valid chapter range for multi-chapter, and none for one-shot', () => {
    const multi = (chaptersMin: number | null, chaptersMax: number | null) =>
      guideRequirementsMissing(validDraft({ type: 'multi_chapter', chaptersMin, chaptersMax }))

    expect(multi(4, 8)).toEqual([])
    expect(multi(null, null)).toContain('Set a valid chapter range')
    expect(multi(8, 4)).toContain('Set a valid chapter range')
    expect(multi(1, 8)).toContain('Set a valid chapter range')
    expect(multi(4, 13)).toContain('Set a valid chapter range')
    expect(guideRequirementsMissing(validDraft({ type: 'one_shot' }))).toEqual([])
  })
})
