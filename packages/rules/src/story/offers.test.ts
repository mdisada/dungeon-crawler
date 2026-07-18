import { describe, expect, it } from 'vitest'

import {
  canReweave, canStageOffer, MAX_OPEN_OFFERS, MAX_REWEAVES, negotiatedGold, offerBanner,
  openingTerms, parseOfferResponse, parseRewardBounds,
} from './offers.ts'

describe('staging caps and the re-weave budget', () => {
  it('allows offers only below the open cap', () => {
    expect(canStageOffer(0)).toBe(true)
    expect(canStageOffer(MAX_OPEN_OFFERS - 1)).toBe(true)
    expect(canStageOffer(MAX_OPEN_OFFERS)).toBe(false)
  })

  it('allows re-weaves only below the budget', () => {
    expect(canReweave(0)).toBe(true)
    expect(canReweave(MAX_REWEAVES - 1)).toBe(true)
    expect(canReweave(MAX_REWEAVES)).toBe(false)
  })
})

describe('parseRewardBounds', () => {
  it('clamps the ceiling to never sit below the floor', () => {
    const bounds = parseRewardBounds({ gold_floor: 50, gold_ceiling: 20 })
    expect(bounds.goldFloor).toBe(50)
    expect(bounds.goldCeiling).toBe(50)
  })

  it('defaults malformed input to zeros and drops non-string extras', () => {
    const bounds = parseRewardBounds({ gold_floor: 'lots', extras: ['a healing potion', 7] })
    expect(bounds).toEqual({ goldFloor: 0, goldCeiling: 0, extras: ['a healing potion'] })
  })

  it('rejects negative gold', () => {
    expect(parseRewardBounds({ gold_floor: -10, gold_ceiling: -5 }).goldFloor).toBe(0)
  })
})

describe('negotiatedGold (haggling clamp - F08 SS2.1)', () => {
  const bounds = { goldFloor: 50, goldCeiling: 100, extras: [] }

  it('a failed check changes nothing', () => {
    expect(negotiatedGold(50, bounds, -3)).toBe(50)
  })

  it('a success moves halfway to the ceiling', () => {
    expect(negotiatedGold(50, bounds, 2)).toBe(75)
    expect(negotiatedGold(75, bounds, 2)).toBe(88)
  })

  it('a decisive success (margin >= 5) reaches the ceiling exactly, never beyond', () => {
    expect(negotiatedGold(50, bounds, 5)).toBe(100)
    expect(negotiatedGold(100, bounds, 9)).toBe(100)
  })

  it('clamps a corrupt current value back into the authored bounds', () => {
    expect(negotiatedGold(999, bounds, 0)).toBeLessThanOrEqual(100)
    expect(negotiatedGold(-5, bounds, -1)).toBe(50)
  })
})

describe('openingTerms', () => {
  it('starts at the authored floor - negotiation earns the rest', () => {
    const terms = openingTerms({ goldFloor: 40, goldCeiling: 90, extras: ['a mule'] }, 'The village fades', 3)
    expect(terms).toEqual({ gold: 40, extras: ['a mule'], stakes: 'The village fades', deadlineDays: 3 })
  })
})

describe('parseOfferResponse (boundary parser)', () => {
  it('accepts the four known kinds from the classifier envelope', () => {
    for (const kind of ['accept', 'decline', 'negotiate', 'unrelated'] as const) {
      expect(parseOfferResponse({ response: kind })).toBe(kind)
    }
  })

  it('degrades anything malformed to unrelated - never blocks the table', () => {
    expect(parseOfferResponse({ response: 'maybe' })).toBe('unrelated')
    expect(parseOfferResponse('yes')).toBe('unrelated')
    expect(parseOfferResponse(null)).toBe('unrelated')
    expect(parseOfferResponse(42)).toBe('unrelated')
  })
})

describe('offerBanner', () => {
  it('renders label, giver, and reward', () => {
    expect(offerBanner('Escort Maren to the coast', 'Elder Maren', 50)).toBe(
      'Escort Maren to the coast (Elder Maren) - 50 gp',
    )
  })

  it('omits the reward clause at zero gold', () => {
    expect(offerBanner('Help the village', 'Elder Maren', 0)).toBe('Help the village (Elder Maren)')
  })
})
