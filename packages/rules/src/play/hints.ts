// Stuck-detection hint ladder (2026-07-20): players who are actively trying but not
// progressing get an escalating, in-fiction nudge from the DM. Pure decision logic - the
// server counts no-progress turns from the event log and delivers the returned rung's
// content (re-frame / orient / steer / fail-forward). Kept pure so the escalation is
// unit-testable, mirroring the other engines.

export type HintRung = 1 | 2 | 3 | 4

/** No-progress turns before the AUTO detector engages (DM-configurable via set_auto). */
export const DEFAULT_HINT_TURNS = 3

export interface HintDecisionInput {
  /** Player turns (intents, excluding dm_command) since the last real progress event. */
  noProgressTurns: number
  /** Hints already delivered since that last progress event (the ladder position). */
  hintsSinceProgress: number
  /** The player explicitly asked ("get your bearings") vs the auto detector sweeping. */
  requested: boolean
  /** Auto-engage threshold. */
  turnsThreshold: number
  /** Rung 4 (fail-forward) is full-AI only; assist stops at rung 3. */
  allowFailForward: boolean
}

/**
 * Decides which hint rung to deliver, or null (say nothing now).
 *
 * - **Requested** hints always land and climb the ladder immediately (the player asked):
 *   rung = hintsSinceProgress + 1, capped at 4.
 * - **Auto** hints stay conservative: they engage only past `turnsThreshold`, and rung R
 *   unlocks only after `turnsThreshold + 2·(R-1)` no-progress turns (one rung per ~2 turns) -
 *   so a confident party gets at most a gentle re-frame, never a walkthrough. An auto rung
 *   that would repeat or regress the ladder holds (null) until the streak earns the next rung.
 * - Rung 4 downshifts to 3 when fail-forward isn't allowed (assist mode).
 */
export function decideHint(input: HintDecisionInput): { rung: HintRung | null } {
  const { noProgressTurns, hintsSinceProgress, requested, turnsThreshold, allowFailForward } = input

  if (!requested && noProgressTurns < turnsThreshold) return { rung: null }

  let rung = Math.min(4, hintsSinceProgress + 1)
  if (!requested) {
    const unlocked = Math.min(4, 1 + Math.floor(Math.max(0, noProgressTurns - turnsThreshold) / 2))
    rung = Math.min(rung, unlocked)
    if (rung <= hintsSinceProgress) return { rung: null } // would repeat/regress - wait for more turns
  }
  if (rung === 4 && !allowFailForward) rung = 3
  if (rung < 1) return { rung: null }
  return { rung: rung as HintRung }
}
