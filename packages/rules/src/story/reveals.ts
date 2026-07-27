// Which undiscovered clue the director's `reveal` rung may surface (2026-07-26).
//
// The rung used to take the first undiscovered ingredient in TABLE ORDER, wherever it lived. Live
// that surfaced a clue placed in the foreman's office while the party stood at the mine entrance,
// and the narrator - handed the raw text - stated it as observed fact: "Veil's knowing hand has
// clearly doubled the collected sums", with no ledger, no office and no Veil in the scene. A later
// firing did the same with the adventure's central twist, spoiling it for free.
//
// Placement is authored; use it. Extracted from session/escalation.ts so the selection rule is
// unit-testable.

export interface RevealCandidate {
  reveals: string | null
  /** Authored placement jsonb: may carry location_id / npc_id. */
  placement?: { location_id?: unknown } | null
}

/**
 * Prefer a clue bound to where the party actually IS; then one bound nowhere (which can surface
 * anywhere); never one bound somewhere else. Order within a group is the caller's (table order),
 * so the choice stays deterministic.
 */
export function pickReveal(
  rows: readonly RevealCandidate[],
  locationId: string | null,
): string | null {
  const usable = rows.filter((r) => typeof r.reveals === 'string' && r.reveals.trim().length > 0)
  const placedAt = (r: RevealCandidate): string | null =>
    typeof r.placement?.location_id === 'string' ? r.placement.location_id : null

  const here = locationId === null
    ? []
    : usable.filter((r) => placedAt(r) === locationId)
  const unplaced = usable.filter((r) => placedAt(r) === null)
  const pick = here[0] ?? unplaced[0] ?? null
  return pick ? pick.reveals!.trim() : null
}
