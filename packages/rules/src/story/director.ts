// The Progress Director (overhaul Phase 3): the deterministic pacing spine.
//
// Before this, three uncoordinated ladders shared the job and none of them could actually move
// the story: the stuck-hint ladder (re-frame/orient/steer/fail-forward), the dead-table stall
// promoter (opens content but writes NO progression, by design), and the idle nudge (wall
// clock, capped at 2). Worse, all of them - and the beat-exit/spent detectors - hung off
// evaluateStoryProgress, which only fires on encounter resolutions, fact writes and scene
// effects. A turn that merely folded into narration reached NO detector at all, which is how a
// 50-turn run spent 35 turns with an unanswered quest offer and 14 turns of investigation that
// could credit nothing (live 2026-07-22).
//
// This module is the pure decision half: counters in, ONE rung out. It runs every turn, so it
// must stay cheap - the caller does pure reads and a counter commit, and only spends an LLM
// call when a rung actually fires.

/**
 * The single escalation ladder, weakest to strongest. Every rung is diegetic; the two rescue
 * rungs are LAB ANOMALIES - a healthy run should never reach them.
 */
export const DIRECTOR_RUNGS = [
  'nudge',            // 1: re-frame what is in front of them, no new information
  'reveal',           // 2: surface an undiscovered clue / hook as an in-fiction detail
  'replan_beat',      // 3: the current beat is not working - author a new one
  'guaranteed_route', // 4: open the objective's code-authored rescue encounter (Phase 4)
  'fail_forward',     // 5: mark the objective failed, narrate the cost, move on (Phase 4)
] as const
export type DirectorRung = (typeof DIRECTOR_RUNGS)[number]
export type DirectorAction = DirectorRung | 'offer_pressure' | 'offer_forced' | 'none'

/**
 * Presses before the world stops asking and simply starts the story (Phase 4). Without this
 * the offer ladder has no terminal step: a party that never answers has no active objective,
 * so the ENTIRE objective ladder - guaranteed routes and fail-forward included - is
 * unreachable, and pressure repeats forever. Live 2026-07-23, a 30-turn passive run: 6
 * presses, 0 objectives, the adventure never began.
 */
export const OFFER_PRESSURE_MAX_PRESSES = 3

/** Beat liveness, as judged from the event log (session/route-health.ts). */
export type RouteHealth = 'healthy' | 'stillborn' | 'spent' | 'missing'

export interface DirectorThresholds {
  /** No-progress turns before each rung unlocks. Must be non-decreasing. */
  nudge: number
  reveal: number
  replanBeat: number
  guaranteedRoute: number
  failForward: number
  /** Turns an un-answered quest offer may sit before the giver presses. */
  offerPressure: number
  /**
   * The SECOND clock, on the objective itself rather than on the silence around it.
   *
   * The rungs above all measure `turnsSinceProgress` - turns since ANYTHING happened - and that
   * counter resets on any milestone at all, including the ones a failed encounter awards. So an
   * objective the party keeps fumbling never looks stuck: they fail, something is credited, the
   * clock returns to zero, and the rescue rungs at 9 and 15 stay permanently out of reach.
   *
   * Live 2026-07-23 (The Tidewater Vault, 100 turns): "Secure the Conscripts Manifest" held the
   * story for 40 turns - the party took the manifest and lost it again - while the ladder never
   * climbed past rung 3, because six failed encounters kept feeding it just enough progress.
   * `turnsOnObjective` sat at 40 the whole time and was read by no decision anywhere.
   *
   * These are deliberately far out: well above the ~20 and ~30 turns objectives 0 and 1 took in
   * that same run, so a healthy objective never trips them. A rescue firing on this clock is a
   * LAB ANOMALY worth investigating upstream, not a feature working.
   */
  guaranteedRouteOnObjective: number
  failForwardOnObjective: number
}

/**
 * Owner-calibrated for a 30-50 turn one-shot (2026-07-22): escalation starts at 2 no-progress
 * turns, and the two rescue rungs sit far out - fail-forward at 15 is a genuine last resort,
 * not a pacing tool. DM-tunable via set_auto.
 */
export const DEFAULT_DIRECTOR_THRESHOLDS: DirectorThresholds = {
  nudge: 2,
  reveal: 4,
  replanBeat: 6,
  guaranteedRoute: 9,
  failForward: 15,
  offerPressure: 3,
  guaranteedRouteOnObjective: 25,
  failForwardOnObjective: 40,
}

export interface DirectorState {
  /** Player turns since the spine last moved. */
  turnsSinceProgress: number
  /** Turns the current objective has been active (never resets on hints). */
  turnsOnObjective: number
  /** Turns the oldest un-answered offer has been standing. */
  offerPendingTurns: number
  /** Highest rung delivered since the last progress event. */
  rung: number
  /** turnsSinceProgress when the last rung fired - prevents same-turn double escalation. */
  lastRungTurn: number
  /**
   * Which objective `turnsOnObjective` is counting. Without it the caller could only detect a
   * change as "there is no objective now", so a normal objective-to-objective handoff never
   * reset the counter and it accumulated across the whole adventure. Harmless while nothing read
   * it; the moment the rescue rungs key on it, every objective after the first would inherit a
   * spent clock and trip a rescue immediately.
   */
  objectiveId?: string | null
}

export const EMPTY_DIRECTOR_STATE: DirectorState = {
  turnsSinceProgress: 0,
  turnsOnObjective: 0,
  offerPendingTurns: 0,
  rung: 0,
  lastRungTurn: -1,
}

export interface DirectorInput {
  state: DirectorState
  thresholds: DirectorThresholds
  /** The active beat's liveness. 'missing' = the loop has no playable beat at all. */
  routeHealth: RouteHealth
  /** An encounter is open - the party has something concrete to do. */
  hasOpenEncounter: boolean
  /** A quest offer is staged and un-answered. */
  hasPendingOffer: boolean
  /** There is an active objective to escalate toward. */
  hasActiveObjective: boolean
  /** Phase 4 gates - a rung that cannot execute must not be selected. */
  guaranteedRouteAvailable: boolean
  failForwardAllowed: boolean
  /**
   * Per-objective jitter in [-1, 1] (seeded, not random - "telegraph, don't schedule"). A
   * ladder that fires on exactly turn 2 every time reads as a machine; tabletop DMs vary.
   */
  jitter?: number
}

export interface DirectorDecision {
  action: DirectorAction
  /** The ladder position this decision represents (0 for none/offer_pressure). */
  rung: number
  reason: string
}

const NONE: DirectorDecision = { action: 'none', rung: 0, reason: '' }

/** Turns between offer presses once the threshold is crossed (backoff, not nagging). */
export const OFFER_PRESSURE_INTERVAL = 4

/** Turn accounting. `progressed` resets the ladder; only real player turns count. */
export function advanceDirectorState(
  prev: DirectorState,
  turn: { countsAsTurn: boolean; progressed: boolean; objectiveChanged: boolean; offerPending: boolean },
): DirectorState {
  if (turn.progressed) {
    return {
      turnsSinceProgress: 0,
      turnsOnObjective: turn.objectiveChanged ? 0 : prev.turnsOnObjective + (turn.countsAsTurn ? 1 : 0),
      offerPendingTurns: turn.offerPending ? prev.offerPendingTurns + (turn.countsAsTurn ? 1 : 0) : 0,
      rung: 0,
      lastRungTurn: -1,
    }
  }
  if (!turn.countsAsTurn) return prev
  return {
    turnsSinceProgress: prev.turnsSinceProgress + 1,
    turnsOnObjective: turn.objectiveChanged ? 0 : prev.turnsOnObjective + 1,
    offerPendingTurns: turn.offerPending ? prev.offerPendingTurns + 1 : 0,
    rung: prev.rung,
    lastRungTurn: prev.lastRungTurn,
  }
}

/** Threshold for a rung index (1-based), with the seeded jitter applied. */
function thresholdFor(rung: number, t: DirectorThresholds, jitter: number): number {
  const base = [t.nudge, t.reveal, t.replanBeat, t.guaranteedRoute, t.failForward][rung - 1]
  return Math.max(1, base + jitter)
}

/**
 * Picks at most ONE action per turn. The ladder is monotonic (never repeats or regresses a
 * rung without progress in between), and a broken route jumps straight to the rung that can
 * fix it - waiting out gentle nudges against a beat that can never be played is exactly the
 * stall this replaces.
 */
export function decideDirector(input: DirectorInput): DirectorDecision {
  const { state, thresholds, routeHealth } = input
  const jitter = Math.max(-1, Math.min(1, Math.round(input.jitter ?? 0)))

  // Offer pressure is orthogonal to the objective ladder: the party has been OFFERED the story
  // and simply hasn't answered. Nothing else can progress until they do, and no amount of
  // hinting at an objective they haven't accepted will help (live 2026-07-22: 35 turns).
  //
  // Backoff is essential: this sits OUTSIDE the monotonic rung ladder, so without it the giver
  // presses on every single turn past the threshold - three identical demands in a row on the
  // first paid Phase-3 run (2026-07-23). A giver who asks once and then lets it breathe reads
  // as a person; one who asks every turn reads as a broken machine.
  if (input.hasPendingOffer && state.offerPendingTurns >= thresholds.offerPressure) {
    const since = state.offerPendingTurns - thresholds.offerPressure
    const presses = Math.floor(since / OFFER_PRESSURE_INTERVAL) + 1
    if (since % OFFER_PRESSURE_INTERVAL === 0) {
      // Terminal step: stop asking, start the story. Gated like fail-forward (full-AI only) -
      // in assist the human DM decides whether the hook is forced.
      if (presses > OFFER_PRESSURE_MAX_PRESSES && input.failForwardAllowed) {
        return {
          action: 'offer_forced',
          rung: 0,
          reason: `offer unanswered after ${OFFER_PRESSURE_MAX_PRESSES} presses - events overtake the party`,
        }
      }
      return {
        action: 'offer_pressure',
        rung: 0,
        reason: `offer unanswered for ${state.offerPendingTurns} turns`,
      }
    }
    // Still un-answered but inside the quiet window: nothing else can progress either, so
    // hold rather than falling through to the objective ladder.
    return NONE
  }

  if (!input.hasActiveObjective) return NONE

  // A dead route cannot be hinted at. Re-plan as soon as the structural fact is known, rather
  // than climbing rungs 1-2 against a beat with no way to play it.
  if (routeHealth === 'stillborn' || routeHealth === 'missing') {
    if (state.rung >= 3) return NONE // already re-planned since the last progress - let it breathe
    return {
      action: 'replan_beat',
      rung: 3,
      reason: `route ${routeHealth}`,
    }
  }
  // A spent beat is the documented "failing an encounter must never cost the story" case; it
  // also needs a re-plan, but it earned one turn of grace so the resolution can land first.
  if (routeHealth === 'spent' && state.turnsSinceProgress >= 1 && state.rung < 3) {
    return { action: 'replan_beat', rung: 3, reason: 'beat spent - no route left' }
  }

  // An open encounter means the party HAS something concrete in front of them, so the gentle
  // rungs - which exist for a table with nothing to do - stay suppressed. But that claim
  // expires. An encounter that has absorbed replanBeat turns without moving the spine is not
  // something to do; it IS the stall.
  //
  // A permanent floor of 4 was a total blackout, because rung 4 carries its own
  // `!state.encounter` guard (session/director.ts) and rung 5 sits at 15. Three guards, all
  // keyed on the same condition, left an exitless conversation with no reachable rung at all.
  // Live 2026-07-23 (The Long Road to Emberfall): 9 no-progress turns inside one social
  // encounter, rung 0, lastRungTurn -1 - the ladder never fired once.
  const stalledInEncounter = state.turnsSinceProgress >= thresholdFor(3, thresholds, jitter)
  const minRung = !input.hasOpenEncounter ? 1 : stalledInEncounter ? 3 : 4

  // A rescue rung unlocks on EITHER clock: a long silence, or a long objective. The gentle rungs
  // (1-3) stay on the silence clock alone - they exist for a table with nothing to do, and a
  // party actively failing at something has plenty to do.
  const onObjective = (rung: number): number | null =>
    rung === 4 ? thresholds.guaranteedRouteOnObjective
      : rung === 5 ? thresholds.failForwardOnObjective
        : null

  for (let rung = 5; rung >= minRung; rung--) {
    if (rung <= state.rung) break // monotonic: never repeat or regress without progress
    const bySilence = state.turnsSinceProgress >= thresholdFor(rung, thresholds, jitter)
    const objectiveLimit = onObjective(rung)
    const byObjective = objectiveLimit !== null && state.turnsOnObjective >= objectiveLimit
    if (!bySilence && !byObjective) continue
    if (rung === 4 && !input.guaranteedRouteAvailable) continue
    if (rung === 5 && !input.failForwardAllowed) continue
    return {
      action: DIRECTOR_RUNGS[rung - 1],
      rung,
      reason: bySilence
        ? `${state.turnsSinceProgress} turns without progress`
        : `${state.turnsOnObjective} turns on this objective without finishing it`,
    }
  }
  return NONE
}

/**
 * Worst-case turns an objective can hold the story before the ladder retires it. Asserted in
 * tests so a threshold edit cannot silently make an adventure unbounded.
 *
 * Keyed on the OBJECTIVE clock, not the silence clock. `failForward` needs 15 consecutive turns
 * of nothing happening, which a party that keeps failing encounters may never produce - so it
 * was never a bound at all, just a hope. `failForwardOnObjective` counts plain turns and cannot
 * be reset by churn, so this is the first version of this number that is actually guaranteed.
 */
export function worstCaseTurnsPerObjective(t: DirectorThresholds = DEFAULT_DIRECTOR_THRESHOLDS): number {
  return t.failForwardOnObjective + 1
}
