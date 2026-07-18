// Quest-offer lifecycle rules (F08 SS2.1): staging caps, the re-weave budget, negotiation
// clamps bounded by the authored contract, and the boundary parser for the offer-response
// classifier. Deterministic - the LLM only ever classifies; every number is decided here.

import type { OfferResponseKind, OfferTerms, RewardBounds } from './types.ts'

/** At most this many unresolved offers outstanding (F08 SS2.1) - the banner is not a todo list. */
export const MAX_OPEN_OFFERS = 2

/** Declined offers re-weave from a different angle at most this many times (F08 SS2.1). */
export const MAX_REWEAVES = 2

export function canStageOffer(openOfferCount: number): boolean {
  return openOfferCount < MAX_OPEN_OFFERS
}

export function canReweave(reweaveCount: number): boolean {
  return reweaveCount < MAX_REWEAVES
}

const clampInt = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)))

/** Authored reward jsonb -> validated bounds: non-negative, ceiling never below floor. */
export function parseRewardBounds(raw: unknown): RewardBounds {
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const floor = clampInt(Number(obj.gold_floor) || 0, 0, 1_000_000)
  const ceiling = clampInt(Number(obj.gold_ceiling) || 0, floor, 1_000_000)
  const extras = Array.isArray(obj.extras) ? obj.extras.filter((x): x is string => typeof x === 'string') : []
  return { goldFloor: floor, goldCeiling: ceiling, extras }
}

/** Opening terms for a fresh offer: the authored floor - negotiation earns the rest. */
export function openingTerms(bounds: RewardBounds, stakes: string, deadlineDays: number | null): OfferTerms {
  return { gold: bounds.goldFloor, extras: bounds.extras, stakes, deadlineDays }
}

/**
 * Haggling outcome (F08 SS2.1): a successful influence check moves the gold halfway to the
 * authored ceiling (a decisive success, margin >= 5, reaches it); failure changes nothing.
 * Never exceeds the ceiling, never drops below the current terms.
 */
export function negotiatedGold(currentGold: number, bounds: RewardBounds, margin: number): number {
  const current = clampInt(currentGold, bounds.goldFloor, bounds.goldCeiling)
  if (margin < 0) return current
  if (margin >= 5) return bounds.goldCeiling
  return clampInt(current + Math.ceil((bounds.goldCeiling - current) / 2), current, bounds.goldCeiling)
}

const RESPONSE_KINDS: OfferResponseKind[] = ['accept', 'decline', 'negotiate', 'unrelated']

/** Boundary parser for the offer-response classifier - anything malformed is 'unrelated'. */
export function parseOfferResponse(raw: unknown): OfferResponseKind {
  const value = typeof raw === 'object' && raw !== null
    ? (raw as Record<string, unknown>).response
    : raw
  return RESPONSE_KINDS.find((k) => k === value) ?? 'unrelated'
}

/** Player-visible banner line: what is on the table, from whom, for how much. */
export function offerBanner(label: string, giverName: string, gold: number): string {
  const reward = gold > 0 ? ` - ${gold} gp` : ''
  return `${label} (${giverName})${reward}`
}
