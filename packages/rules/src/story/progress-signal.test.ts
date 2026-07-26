import { describe, expect, it } from 'vitest'

import { isSpineProgress, progressedSince } from './progress-signal'

const ev = (type: string, payload?: Record<string, unknown>) => ({ type, payload })

describe('isSpineProgress', () => {
  it('counts the things that actually move the authored story', () => {
    for (const t of ['milestone_reached', 'beat_exit_met', 'objective_completed',
      'objective_revealed', 'offer_accepted', 'ingredient_revealed']) {
      expect(isSpineProgress(ev(t))).toBe(true)
    }
  })

  it('counts an AUTHORED node resolving, whatever the tier', () => {
    expect(isSpineProgress(ev('encounter_resolved', { node_key: 'obj:x#n0', tier: 'failed' }))).toBe(true)
  })

  it('counts any resolution that actually credited a milestone', () => {
    expect(isSpineProgress(ev('encounter_resolved', { milestones: ['ledger_found'] }))).toBe(true)
  })

  it('does NOT count an ad-hoc resolution that credited nothing', () => {
    // The heist run: "Sudden hazard near open water" resolved three times, crediting nothing,
    // and reset the stall counter every time.
    expect(isSpineProgress(ev('encounter_resolved', { label: 'Sudden hazard', milestones: [] }))).toBe(false)
    expect(isSpineProgress(ev('encounter_resolved', { label: 'Sudden hazard' }))).toBe(false)
  })

  it('does NOT count an encounter merely OPENING - including a random spawn', () => {
    expect(isSpineProgress(ev('encounter_opened', { kind: 'skill_challenge' }))).toBe(false)
  })

  it('does NOT count travel - walking somewhere is not the story moving', () => {
    expect(isSpineProgress(ev('scene_travel', { name: 'The narrow passage' }))).toBe(false)
  })

  it('counts committing to the OFFERED encounter, but never the adhoc escape valve', () => {
    expect(isSpineProgress(ev('entry_mapped', { entry: 'offered' }))).toBe(true)
    expect(isSpineProgress(ev('entry_mapped', { entry: 'adhoc' }))).toBe(false)
    expect(isSpineProgress(ev('entry_mapped', { entry: 'fold_in' }))).toBe(false)
  })

  it('counts a successful attempt inside a scene being played', () => {
    expect(isSpineProgress(ev('encounter_attempt', { success: true }))).toBe(true)
    expect(isSpineProgress(ev('encounter_attempt', { result: 'solves' }))).toBe(true)
    expect(isSpineProgress(ev('encounter_attempt', { success: false }))).toBe(false)
  })

  it('ignores unrelated chatter', () => {
    expect(isSpineProgress(ev('narration_published', { text: 'x' }))).toBe(false)
    expect(isSpineProgress(ev('intent_submitted', { text: 'ok' }))).toBe(false)
  })
})

describe('progressedSince', () => {
  it('a window of pure filler is NOT progress - the ladder may now escalate', () => {
    const filler = [
      ev('intent_submitted', { text: 'ok' }),
      ev('scene_travel', { name: 'the docks' }),
      ev('encounter_opened', { kind: 'skill_challenge' }),
      ev('encounter_resolved', { label: 'Sudden hazard', milestones: [] }),
      ev('entry_mapped', { entry: 'adhoc' }),
      ev('narration_published', {}),
    ]
    expect(progressedSince(filler)).toBe(false)
  })

  it('one real spine event in the window is enough', () => {
    expect(progressedSince([
      ev('intent_submitted', { text: 'ok' }),
      ev('encounter_resolved', { node_key: 'obj:x#n1', tier: 'full' }),
    ])).toBe(true)
  })

  it('an empty window is not progress', () => {
    expect(progressedSince([])).toBe(false)
  })
})
