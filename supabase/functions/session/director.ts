// The Progress Director's execution half (overhaul Phase 3). Runs on EVERY player turn from
// intent.ts - the one hook every turn passes through - so a turn that merely folds into
// narration is no longer invisible to the pacing machinery.
//
// Cheap by construction: the common path is pure reads plus one counter commit. An LLM call
// happens only when a rung actually fires. The pure decision lives in story/director.ts.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { dmSettings } from '../_shared/play/index.ts'
import {
  activeLoop, advanceDirectorState, decideDirector, DEFAULT_DIRECTOR_THRESHOLDS,
  EMPTY_DIRECTOR_STATE,
} from '../_shared/story/index.ts'
import type { DirectorDecision, DirectorState, DirectorThresholds } from '../_shared/story/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { loadLoops, planAndOpenBeat } from './beats.ts'
import { openSkillChallengeFromSpec } from './encounters.ts'
import type { StoredBeatSpec } from './encounters.ts'
import { deliverRung, promoteOpening } from './escalation.ts'
import { narrationBeat } from './narration.ts'
import { evaluateStoryProgress, failObjective } from './progress.ts'
import { beatRouteHealth } from './route-health.ts'
import { forceAcceptOffer } from './story.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

/**
 * The stored guaranteed_route jsonb -> the spec shape the encounter machinery instantiates.
 * Code-authored at guide time, so this only has to tolerate absence, never invention.
 */
function parseGuaranteedRoute(raw: Json): StoredBeatSpec | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const r = raw as Record<string, Json>
  if (typeof r.label !== 'string' || !r.label.trim()) return null
  const strings = (v: Json | undefined) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  const onSuccess = strings(r.onSuccess)
  if (onSuccess.length === 0) return null // a rescue that credits nothing is not a rescue
  const params = (typeof r.params === 'object' && r.params !== null && !Array.isArray(r.params)
    ? r.params
    : {}) as Record<string, Json>
  return {
    kind: 'skill_challenge',
    label: r.label,
    stakes: typeof r.stakes === 'string' ? r.stakes : '',
    // The template's guidance rides along so the narration can skin the shape + twist.
    params: { ...params, guidance: typeof r.guidance === 'string' ? r.guidance : '' },
    onSuccess,
    onPartial: strings(r.onPartial),
    onFailure: strings(r.onFailure),
  }
}

/**
 * Phase-3 rollout switch. false = SHADOW: counters advance and decisions are logged as
 * `director_shadow`, but nothing is delivered and the legacy ladders keep running. Flip to
 * true after a paid lab sweep shows the rungs fire where a human would want them.
 */
export const DIRECTOR_APPLIES = true

/**
 * Phase-4 rescue rungs. GUARANTEED_ROUTE opens the objective's code-authored encounter (safe:
 * it can only be completed by actually playing it). FAIL_FORWARD retires an objective the
 * party never managed - the product-risky one, so it stays flag-gated indefinitely, is full-AI
 * only (assist gets a DM proposal), and sits at a deliberately distant threshold.
 */
export const GUARANTEED_ROUTE_APPLIES = true
export const FAIL_FORWARD_APPLIES = true

function thresholdsFor(state: GameState): DirectorThresholds {
  const overrides = dmSettings(state).directorThresholds ?? {}
  return {
    nudge: overrides.nudge ?? DEFAULT_DIRECTOR_THRESHOLDS.nudge,
    reveal: overrides.reveal ?? DEFAULT_DIRECTOR_THRESHOLDS.reveal,
    replanBeat: overrides.replanBeat ?? DEFAULT_DIRECTOR_THRESHOLDS.replanBeat,
    guaranteedRoute: overrides.guaranteedRoute ?? DEFAULT_DIRECTOR_THRESHOLDS.guaranteedRoute,
    failForward: overrides.failForward ?? DEFAULT_DIRECTOR_THRESHOLDS.failForward,
    offerPressure: overrides.offerPressure ?? DEFAULT_DIRECTOR_THRESHOLDS.offerPressure,
    guaranteedRouteOnObjective:
      overrides.guaranteedRouteOnObjective ?? DEFAULT_DIRECTOR_THRESHOLDS.guaranteedRouteOnObjective,
    failForwardOnObjective:
      overrides.failForwardOnObjective ?? DEFAULT_DIRECTOR_THRESHOLDS.failForwardOnObjective,
  }
}

function directorStateOf(state: GameState): DirectorState {
  return state.dm?.story?.director ?? EMPTY_DIRECTOR_STATE
}

/**
 * Seeded jitter in [-1, 1] from the objective id - "telegraph, don't schedule". Stable per
 * objective so the ladder is reproducible in a lab replay, but not the same every time.
 */
function jitterFor(objectiveId: string | null): number {
  if (!objectiveId) return 0
  let h = 0
  for (let i = 0; i < objectiveId.length; i++) h = (h * 31 + objectiveId.charCodeAt(i)) | 0
  return (Math.abs(h) % 3) - 1
}

/** Did the spine move on this turn? Mirrors the old hints.ts isProgress vocabulary. */
const PROGRESS_TYPES = new Set([
  'milestone_reached', 'beat_exit_met', 'objective_completed', 'objective_revealed',
  'encounter_resolved', 'encounter_opened', 'scene_travel', 'offer_accepted', 'ingredient_revealed',
])

async function progressedSince(
  service: SupabaseClient,
  adventureId: string,
  sinceEventId: number,
): Promise<boolean> {
  const { data } = await service
    .from('event_log')
    .select('type, payload')
    .eq('adventure_id', adventureId)
    .gt('id', sinceEventId)
    .limit(80)
  for (const e of (data ?? []) as { type: string; payload: Record<string, Json> | null }[]) {
    if (PROGRESS_TYPES.has(e.type)) return true
    if (e.type === 'encounter_attempt' && (e.payload?.success === true || e.payload?.result === 'solves')) return true
    if (e.type === 'entry_mapped' && (e.payload?.entry === 'offered' || e.payload?.entry === 'adhoc')) return true
  }
  return false
}

export interface DirectorTurnContext {
  /** Highest event_log id BEFORE this turn ran - progress is measured after it. */
  sinceEventId: number
  /** dm_command turns and pure chat do not count toward the stuck streak. */
  countsAsTurn: boolean
}

/**
 * One director pass. Never throws into the player's turn: pacing is background bookkeeping,
 * and a director failure must never cost a player their input (the lesson of the 546 storm).
 */
export async function runProgressDirector(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  ctx: DirectorTurnContext,
): Promise<DirectorDecision | null> {
  try {
    if (env.demo) return null // scripted fixtures: an unsolicited rung corrupts their assertions
    const state = (await loadState(service, env.adventureId)).state
    if (state.dialogue.pending || state.dialogue.typing || state.dm?.pendingReview) return null

    const progressed = await progressedSince(service, env.adventureId, ctx.sinceEventId)
    const currentObjectiveId = state.objectives.currentId ?? null
    const pendingOffer = (state.objectives.offers ?? [])[0] ?? null

    const previous = directorStateOf(state)
    // Compare the objective ITSELF. The old test - "we had an objective and now we do not" - was
    // false on every normal handoff (objective 1 completes, objective 2 activates, the id is
    // still truthy), so turnsOnObjective accumulated across the whole adventure instead of
    // measuring one objective. That is fine while nothing reads it and fatal the moment the
    // rescue rungs do.
    const objectiveChanged = (previous.objectiveId ?? null) !== currentObjectiveId
    const next = advanceDirectorState(previous, {
      countsAsTurn: ctx.countsAsTurn,
      progressed,
      objectiveChanged,
      offerPending: Boolean(pendingOffer),
    })
    next.objectiveId = currentObjectiveId

    // Route health only matters when there is a ladder to run; skip the queries otherwise.
    const loops = await loadLoops(service, env.adventureId)
    const loop = activeLoop(loops)
    let routeHealth: 'healthy' | 'stillborn' | 'spent' | 'missing' = 'healthy'
    if (currentObjectiveId && !pendingOffer) {
      if (!loop?.currentBeatId) {
        routeHealth = loop ? 'missing' : 'healthy' // no loop at all = story not started yet
      } else {
        const { data: beat } = await service
          .from('beats')
          .select('id, status, encounter_spec')
          .eq('id', loop.currentBeatId)
          .maybeSingle()
        routeHealth = await beatRouteHealth(service, {
          adventureId: env.adventureId,
          beatId: (beat?.id as string) ?? null,
          beatStatus: (beat?.status as string) ?? null,
          encounterSpec: (beat?.encounter_spec ?? null) as Json,
          state,
          turnsSinceBeatOpened: next.turnsSinceProgress,
        })
      }
    }

    // The current objective's rescue route (Phase 4). Loaded only when the ladder is deep
    // enough to possibly need it - it is a table read on a hot path otherwise.
    //
    // BOTH clocks, or the rung that unlocks on the objective clock finds no route and skips
    // itself - a guard keyed on the old condition quietly cancelling the new one. This preload
    // is the exact shape that made rung 4 unreachable during an open encounter earlier today.
    const th = thresholdsFor(state)
    let guaranteedRoute: StoredBeatSpec | null = null
    if (currentObjectiveId && (
      next.turnsSinceProgress >= th.guaranteedRoute - 1 ||
      next.turnsOnObjective >= th.guaranteedRouteOnObjective - 1
    )) {
      const { data: objectiveRow } = await service
        .from('objectives')
        .select('guaranteed_route')
        .eq('id', currentObjectiveId)
        .maybeSingle()
      guaranteedRoute = parseGuaranteedRoute((objectiveRow?.guaranteed_route ?? null) as Json)
    }

    const decision = decideDirector({
      state: next,
      thresholds: th,
      routeHealth,
      hasOpenEncounter: Boolean(state.encounter),
      hasPendingOffer: Boolean(pendingOffer),
      hasActiveObjective: Boolean(currentObjectiveId),
      // Only offerable when nothing is already open. Opening a rescue logs `encounter_opened`,
      // which counts as progress and resets the ladder (rung included) - so a party that
      // IGNORES the rescue would climb back to rung 4 and open another one, forever, and
      // fail_forward could never be reached. Live 2026-07-23, the first stall run. With an
      // encounter open the ladder's floor is rung 4, so withholding it here leaves exactly one
      // legal move: rung 5. The story stays bounded.
      guaranteedRouteAvailable: GUARANTEED_ROUTE_APPLIES && guaranteedRoute !== null && !state.encounter,
      // Assist never auto-fails: failObjective records a DM proposal instead, so offering the
      // rung there would burn the ladder's last step on a decision the DM has not made yet.
      failForwardAllowed: FAIL_FORWARD_APPLIES && env.mode === 'full_ai',
      jitter: jitterFor(currentObjectiveId),
    })

    const committed: DirectorState = decision.action === 'none'
      ? next
      : { ...next, rung: Math.max(next.rung, decision.rung), lastRungTurn: next.turnsSinceProgress }
    await commitDiffs(service, env.adventureId, () => [
      { domain: 'dm', patch: { story: { director: committed as unknown as Json } } },
    ]).catch(() => {})

    if (decision.action === 'none') return decision
    if (!DIRECTOR_APPLIES) {
      await logEvent(service, env.adventureId, sessionId, 'director_shadow', {
        action: decision.action, rung: decision.rung, reason: decision.reason,
        counters: next as unknown as Json, route_health: routeHealth,
      })
      return decision
    }

    await logEvent(service, env.adventureId, sessionId, 'director_action', {
      action: decision.action, rung: decision.rung, reason: decision.reason,
      counters: next as unknown as Json, route_health: routeHealth,
    })

    // Before spending a rung, ask whether the fiction has ALREADY done it. The recognition judge
    // only ever ran on a beat ending, which is precisely the event a stuck story cannot produce:
    // The Wintering House sat 30 turns on "party encountered elara" while the party was in a
    // scene with Elara five times, and the judge never got to look. Escalating is the strongest
    // signal we have that the deterministic path has missed something, so it is the right moment
    // to check - and a `completed` verdict credits its atom, which resolves the stall outright.
    if (decision.rung >= 2) {
      await evaluateStoryProgress(service, env, sessionId, { forceRecognition: true })
        .catch((err) => console.error('recognition pass failed', err))
    }

    if (decision.action === 'replan_beat') {
      if (loop) {
        try {
          await planAndOpenBeat(service, env, sessionId, loop.id, 'director_replan')
        } catch (err) {
          console.error('director re-plan failed', err)
          await logEvent(service, env.adventureId, sessionId, 'incident', {
            kind: 'director_replan_failed', route_health: routeHealth,
          }).catch(() => {})
        }
      } else {
        // Active objective, no loop to re-plan (a completed quest loop, or a pivot that left
        // the stack empty). Nothing to author a beat ON, so open what the party has been
        // reaching for instead of leaving them with an objective and no route at all.
        await promoteOpening(service, env, sessionId, state).catch((err) =>
          console.error('director promote failed', err))
      }
      return decision
    }

    if (decision.action === 'guaranteed_route') {
      // The authored routes did not work out. Open the code-authored one: its outcome map was
      // generated from the objective's own predicate, so succeeding here provably completes it.
      // The party still has to PLAY it - this is a route, not a handout.
      if (guaranteedRoute) {
        await openSkillChallengeFromSpec(service, env, sessionId, guaranteedRoute)
        await narrationBeat(
          service, env, sessionId,
          `${String(guaranteedRoute.params.guidance ?? '')} Put "${guaranteedRoute.label}" in front of the ` +
            'party NOW as the concrete way at what they have been failing to reach. Make the shape and ' +
            'its twist immediate and physical, and end demanding their first move against it.',
          'A way through opens',
        )
      }
      return decision
    }

    if (decision.action === 'offer_forced') {
      // Stop asking; start the story. This is what makes the objective ladder reachable at all
      // for a party that never answers - without it nothing below this line can ever run.
      const started = await forceAcceptOffer(service, env, sessionId)
      if (!started) {
        await logEvent(service, env.adventureId, sessionId, 'incident', {
          kind: 'offer_force_failed',
        }).catch(() => {})
      }
      return decision
    }

    if (decision.action === 'fail_forward') {
      await failObjective(service, env, sessionId, decision.reason)
      // The ladder just retired an objective; re-score endings so a story whose objectives are
      // now all terminal actually commits one instead of stopping.
      await evaluateStoryProgress(service, env, sessionId).catch((err) =>
        console.error('post-fail progress pass failed', err))
      return decision
    }

    await deliverRung(service, env, sessionId, state, decision, pendingOffer)
    return decision
  } catch (err) {
    console.error('progress director failed', err)
    return null
  }
}
