// Who is allowed to complete an OBJECTIVE (2026-07-26).
//
// F08 §9.2.4 has always said outcome maps own progression, but the rule lived only as prose and
// had drifted. Live in The Lamplighters' Tithe: the Archivist's scene ledger credited "party
// examined the flickering lamps" because someone glanced at a lamp, and the adjudicator credited
// "party entered the Drift" because someone walked in. Two objectives - the entire quest - were
// done by turn 6, the party was PAID for solving a mystery they had never touched, and the
// narrator offered to let them leave town while the antagonist had not yet appeared.
//
// Extracted from session/milestones.ts so the rule is unit-testable: everything under
// supabase/functions/ has no test runner, and this is the single gate standing between a real
// deed and a free objective.

/**
 * Sources that represent an actual DEED.
 *
 * - `encounter_outcome` - the authored outcome map fired, i.e. the party played and resolved it.
 * - `objective_judge` - the recognition judge, which demands a verbatim evidence quote about the
 *   objective's intent. Deliberately kept: it is the path for progress won in fiction, and it is
 *   a different act from noticing a verb.
 *
 * Everything else (`scene_ledger`, `adjudicator_mark_event`, `adjudicator`) stays useful for BEAT
 * atoms and colour - it simply may not finish the spine.
 */
export const OBJECTIVE_CREDIT_SOURCES = ['encounter_outcome', 'objective_judge'] as const
export type ObjectiveCreditSource = (typeof OBJECTIVE_CREDIT_SOURCES)[number]

export function isObjectiveCreditSource(source: string): boolean {
  return (OBJECTIVE_CREDIT_SOURCES as readonly string[]).includes(source)
}

export interface CreditInput {
  /** Where the proposal came from (the `source` argument to applyMilestones). */
  source: string
  /** Does this atom appear in an OBJECTIVE's completion predicate (vs only a beat exit)? */
  isObjectiveAtom: boolean
  /** Rollout switch - false restores pre-gate behaviour exactly. */
  enforced: boolean
}

export type CreditDecision =
  | { apply: true }
  | { apply: false; reason: string }

/**
 * Pure decision. Beat atoms are never gated - only atoms that would COMPLETE AN OBJECTIVE, and
 * only when the source is not a real deed.
 */
export function decideCredit(input: CreditInput): CreditDecision {
  if (!input.enforced) return { apply: true }
  if (!input.isObjectiveAtom) return { apply: true }
  if (isObjectiveCreditSource(input.source)) return { apply: true }
  return {
    apply: false,
    reason: 'objective atoms are credited by outcome maps and the recognition judge only',
  }
}
