// Encounter-states Slice 1: the visible frame renders from broadcast state alone, and the
// encounter domain flows through the same merge-patch pipeline as every other domain.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { applyDiffs, initialGameState } from '@rules/state'
import type { EncounterState } from '@rules/state'

import { EncounterBanner } from './components/encounter-banner'

const challenge: EncounterState = {
  id: 'enc-1',
  kind: 'skill_challenge',
  label: 'Cross the flooded causeway',
  stakes: 'The tide takes the supply cart',
  progress: {
    successes: 1, neededSuccesses: 3, failures: 0, maxFailures: 2,
    suggestedSkills: ['athletics', 'survival'],
  },
  contributions: { c1: 1 },
  startedAt: '2026-07-19T00:00:00Z',
}

describe('EncounterBanner', () => {
  it('renders kind, label, progress, and stakes for a skill challenge', () => {
    render(<EncounterBanner encounter={challenge} />)
    expect(screen.getByText(/Skill challenge: Cross the flooded causeway/)).toBeTruthy()
    expect(screen.getByText('1/3 successes · 0/2 setbacks')).toBeTruthy()
    expect(screen.getByText('The tide takes the supply cart')).toBeTruthy()
  })

  it('tells the player how to engage, including the suggested skills', () => {
    render(<EncounterBanner encounter={challenge} />)
    expect(screen.getByText(/Tell the DM each attempt/)).toBeTruthy()
    expect(screen.getByText(/athletics, survival/)).toBeTruthy()
  })

  it('gives kind-specific guidance for social encounters', () => {
    render(<EncounterBanner encounter={{ ...challenge, kind: 'social', progress: { exchanges: 2 } }} />)
    expect(screen.getByText(/Talk it out/)).toBeTruthy()
  })

  it('omits the progress line when the shape is not recognizable', () => {
    render(<EncounterBanner encounter={{ ...challenge, kind: 'combat', progress: null }} />)
    expect(screen.getByText(/Combat: Cross the flooded causeway/)).toBeTruthy()
    expect(screen.queryByText(/successes/)).toBeNull()
  })

  it('renders nothing when no encounter is open', () => {
    const { container } = render(<EncounterBanner encounter={null} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('encounter state diffs', () => {
  it('opens, merges progress, and closes through the shared merge-patch pipeline', () => {
    let state = applyDiffs(initialGameState(), [{ domain: 'encounter', patch: challenge as never }])
    expect(state.encounter?.label).toBe('Cross the flooded causeway')
    state = applyDiffs(state, [{ domain: 'encounter', patch: { progress: { successes: 2 } } }])
    expect(state.encounter?.progress).toMatchObject({ successes: 2, neededSuccesses: 3 })
    state = applyDiffs(state, [{ domain: 'encounter', patch: null }])
    expect(state.encounter).toBeNull()
  })
})
