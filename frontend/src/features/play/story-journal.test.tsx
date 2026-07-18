// F08 SS2.1/SS2.2 journal surfaces: the offer banner renders from broadcast state alone, and
// journal diffs flow through the same merge-patch pipeline every other domain uses.
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'

afterEach(cleanup)

import { applyDiffs, initialGameState } from '@rules/state'
import type { OfferBannerView } from '@rules/state'

import { OfferBanner } from './components/offer-banner'

const offer: OfferBannerView = {
  id: 'offer-1',
  label: 'Escort Maren to the coast',
  giverName: 'Elder Maren',
  gold: 50,
  stakes: 'The village fades, one dreamer at a time.',
}

describe('OfferBanner', () => {
  it('renders label, giver, gold, and stakes for each open offer', () => {
    render(<OfferBanner offers={[offer]} />)
    expect(screen.getByText(/Escort Maren to the coast/)).toBeTruthy()
    expect(screen.getByText(/Elder Maren, 50 gp/)).toBeTruthy()
    expect(screen.getByText('The village fades, one dreamer at a time.')).toBeTruthy()
  })

  it('omits the gold clause when nothing is promised', () => {
    render(<OfferBanner offers={[{ ...offer, gold: 0, stakes: '' }]} />)
    expect(screen.getByText(/\(Elder Maren\)/)).toBeTruthy()
    expect(screen.queryByText(/gp/)).toBeNull()
  })

  it('renders nothing with no open offers', () => {
    const { container } = render(<OfferBanner offers={[]} />)
    expect(container.firstChild).toBeNull()
  })
})

describe('journal state diffs', () => {
  it('offers/quests/gold flow through merge patches like every other domain', () => {
    const state = applyDiffs(initialGameState(), [
      { domain: 'objectives', patch: { offers: [offer as never], quests: [] } },
      { domain: 'players', patch: { gold: 50 } },
    ])
    expect(state.objectives.offers).toHaveLength(1)
    expect(state.players.gold).toBe(50)

    const cleared = applyDiffs(state, [
      {
        domain: 'objectives',
        patch: {
          offers: [],
          quests: [{
            id: 'offer-1', label: 'Escort Maren to the coast', giverName: 'Elder Maren',
            gold: 75, stakes: '', status: 'active',
          } as never],
        },
      },
    ])
    expect(cleared.objectives.offers).toHaveLength(0)
    expect(cleared.objectives.quests[0].gold).toBe(75)
  })
})
