// F08 SS9 + SS8.1: the deterministic story-progress pass. Evaluates the active objective's
// completion predicate and the open beat's exit conditions against the world fact base,
// advances the reveal order, re-scores candidate endings on every pass (an Engine, not an
// LLM), and drafts the commitment when one ending pulls decisively clear near the climax.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { foreignCharacters, stripForeign } from '../_shared/guide/charset.ts'
import type { GameState, Json, StateDiff } from '../_shared/state/index.ts'
import {
  commitmentReady, evaluatePredicate, ladderReady, listMilestoneAtoms,
  parseEndingSignals, scoreEndings,
} from '../_shared/story/index.ts'
import type { EndingCandidate, EndingWorld, WorldFacts } from '../_shared/story/index.ts'
import { runClaimCheck, runConsistency, runObjectiveJudge } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { ensureSpineLoop, loadLoops, planAndOpenBeat } from './beats.ts'
import { graphDecision, inPlayNodeKey, loadObjectiveNodes } from './graph-read.ts'
import { establishedSoFar } from './canon.ts'
import { recordSceneLedger } from './ledger.ts'
import { applyMilestones } from './milestones.ts'
import { narrationBeat } from './narration.ts'
import { appendLinesDiff, newLine, typingDiff } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { beatRouteHealth } from './route-health.ts'
import { antagonistTurn } from './steward.ts'
import { maybeResolveQuestForObjective, maybeReweaveDeclined } from './story.ts'
import { personalEpilogueLines } from './personal.ts'
import { runClimaxAuthor } from './story-agents.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

/**
 * Recognition judge rollout switch. true = LIVE: a completed-verdict credits its cited atom
 * through applyMilestones (validated + idempotent). Flipped after two shadow sweeps
 * (2026-07-22): 11 firings - 9 correct refusals, 1 yes later confirmed by the deterministic
 * path, 1 premature yes (enabling-event conflation) now explicitly prompted against. Every
 * credit still logs `objective_recognized` with its verbatim-evidence quote - audit those in
 * every paid sweep, and flip back to false (shadow) if a credit's quote does not prove the deed.
 */
const OBJECTIVE_JUDGE_APPLIES = true

/**
 * Only the `tag` string matters here, so project it in the query rather than hauling 300 whole
 * jsonb payloads into the worker - this pass runs the app's longest agent chain and has died on
 * WORKER_RESOURCE_LIMIT (live 2026-07-20), so its allocations are worth keeping small.
 */
async function storyEventTags(service: SupabaseClient, adventureId: string): Promise<Set<string>> {
  const { data, error } = await service
    .from('event_log')
    .select('tag:payload->>tag')
    .eq('adventure_id', adventureId)
    .eq('type', 'story_event')
    .order('id', { ascending: false })
    .limit(300)
  assertOk(error, 'story events load failed')
  return new Set(
    ((data ?? []) as { tag: string | null }[])
      .map((e) => e.tag ?? '')
      .filter(Boolean),
  )
}

function worldFacts(state: GameState, events: Set<string>): WorldFacts {
  const facts: Record<string, Json> = { ...(state.dm?.facts.world ?? {}) }
  for (const [npcId, status] of Object.entries(state.dm?.facts.npcStates ?? {})) {
    facts[`npc.${npcId}.status`] = status
  }
  return { facts, flags: state.dm?.facts.flags ?? {}, events }
}

interface ObjectiveRow {
  id: string
  chapter_id: string
  index: number
  title: string
  reveal_state: string
  /** Terminal state once retired (Phase 4): 'completed' | 'failed' | null while still open. */
  outcome?: string | null
  /** Code-authored rescue encounter (Phase 4) - the director's rung-4 route. */
  guaranteed_route?: Json
  completion_predicates: Json
  /** DM-only intent - the recognition judge's core context (what the objective is REALLY about). */
  hidden_description: string | null
  /** 'main' = a plot point that cannot be failed; 'side' = an optional thread that can be lost.
   *  Absent on rows written before 2026-07-29; the column defaults to 'main'. */
  kind?: string | null
}

export async function orderedObjectives(service: SupabaseClient, adventureId: string): Promise<ObjectiveRow[]> {
  const [{ data: chapters }, { data: objectives }] = await Promise.all([
    service.from('chapters').select('id, index').eq('adventure_id', adventureId).order('index'),
    service.from('objectives').select('id, chapter_id, index, title, reveal_state, outcome, guaranteed_route, completion_predicates, hidden_description, kind').eq('adventure_id', adventureId),
  ])
  const chapterOrder = new Map(((chapters ?? []) as { id: string; index: number }[]).map((c) => [c.id, c.index]))
  return ((objectives ?? []) as ObjectiveRow[]).sort((a, b) => {
    const chapterDiff = (chapterOrder.get(a.chapter_id) ?? 0) - (chapterOrder.get(b.chapter_id) ?? 0)
    return chapterDiff !== 0 ? chapterDiff : a.index - b.index
  })
}

/** NPC states for ending signals: dead/absent from facts, allied/hostile from dispositions. */
async function endingNpcStates(service: SupabaseClient, adventureId: string, state: GameState): Promise<Record<string, string>> {
  const states: Record<string, string> = { ...(state.dm?.facts.npcStates ?? {}) }
  const { data } = await service.from('npc_dispositions').select('npc_id, value').eq('adventure_id', adventureId)
  const sums = new Map<string, { total: number; count: number }>()
  for (const row of (data ?? []) as { npc_id: string; value: number }[]) {
    const entry = sums.get(row.npc_id) ?? { total: 0, count: 0 }
    entry.total += Number(row.value)
    entry.count += 1
    sums.set(row.npc_id, entry)
  }
  for (const [npcId, { total, count }] of sums) {
    if (states[npcId] === 'dead') continue
    const avg = total / count
    if (avg >= 5) states[npcId] = 'allied'
    else if (avg <= -5) states[npcId] = 'hostile'
    else states[npcId] ??= 'alive'
  }
  return states
}

async function completeObjective(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  completed: ObjectiveRow,
  ordered: ObjectiveRow[],
  world: WorldFacts,
): Promise<boolean> {
  // CLAIM the transition atomically (2026-07-27). Several progress passes legitimately overlap -
  // the inline head, the tail in its own worker, and the director each run one - and they all read
  // the objective as `active` before any of them writes. Unguarded, every one of them completes it
  // and logs `objective_completed`, so the party is told twice and the quest ladder advances on a
  // duplicate. `updateEndings` already learned this exact lesson (live 2026-07-24, one ending
  // published three times) and claims `committed_ending_id` the same way.
  //
  // Intermittent by nature, which is what made it so easy to wave off: story-live failed on it
  // twice, passed three times, and I called it a flake before looking. Today's completion path
  // added DB round-trips ahead of this write, widening the window rather than causing it.
  const { data: claimedObjective } = await service
    .from('objectives')
    .update({ reveal_state: 'completed' })
    .eq('id', completed.id)
    .eq('reveal_state', 'active')
    .select('id')
  if (!claimedObjective || claimedObjective.length === 0) return false // another pass got there first

  await recordSceneLedger(service, env, sessionId, 'objective', completed.title)
  await logEvent(service, env.adventureId, sessionId, 'objective_completed', {
    objective_id: completed.id, title: completed.title, evaluated: true,
  })
  completed.reveal_state = 'completed' // keep the in-memory ladder in step with the DB for the skip below

  // Reveal the next thread - but skip any objective whose predicate is ALREADY satisfied at reveal
  // time. An objective the fiction has met before the player ever saw it (classically "find the
  // NPC who is handing you this very quest") must not flash up as a checklist item and complete the
  // same beat: to the player a goal appears and vanishes "for no reason", and the ladder telescopes
  // straight to whatever comes after. Live 2026-07-22, The Whispering Depths: "Find Borin Stonehand"
  // was revealed and completed 6s apart - Borin is the quest-giver, present from the opening line -
  // exposing the climax objective "Confront the Heart of the Shard" with no bridge. Collapse those
  // pre-satisfied rungs silently (recorded, but no narration beat) and land on the first objective
  // the party has NOT yet met - that one is the real next thread, and the only one worth surfacing.
  const silentlyCompleted: ObjectiveRow[] = []
  let next = ordered.find((o) => o.reveal_state === 'hidden')
  while (next && evaluatePredicate(next.completion_predicates, world)) {
    const { data: claimedNext } = await service
      .from('objectives').update({ reveal_state: 'completed' })
      .eq('id', next.id).eq('reveal_state', 'hidden').select('id')
    if (!claimedNext || claimedNext.length === 0) break // a concurrent pass collapsed it already
    await logEvent(service, env.adventureId, sessionId, 'objective_completed', {
      objective_id: next.id, title: next.title, evaluated: true, presatisfied: true,
    })
    next.reveal_state = 'completed'
    silentlyCompleted.push(next)
    next = ordered.find((o) => o.reveal_state === 'hidden')
  }
  if (next) {
    await service.from('objectives').update({ reveal_state: 'active' }).eq('id', next.id)
    await logEvent(service, env.adventureId, sessionId, 'objective_revealed', { objective_id: next.id, title: next.title })
    next.reveal_state = 'active'
  }

  const closed = [completed, ...silentlyCompleted]
  await commitDiffs(service, env.adventureId, (s) => {
    const touched = new Set([...closed.map((o) => o.id), ...(next ? [next.id] : [])])
    const list = [
      ...s.objectives.list.filter((o) => !touched.has(o.id)),
      ...closed.map((o) => ({ id: o.id, title: o.title, state: 'completed' })),
      ...(next ? [{ id: next.id, title: next.title, state: 'active' }] : []),
    ]
    const diffs: StateDiff[] = [
      appendLinesDiff(s, closed.map((o) => newLine(null, null, `Objective complete: ${o.title}`))),
      { domain: 'objectives', patch: { currentId: next?.id ?? null, list: list as unknown as Json } },
    ]
    return diffs
  })

  // If this closed the last open objective of an accepted quest's contract, resolve the quest.
  // TWO sets, because `reveal_state: 'completed'` means TERMINAL since fail-forward landed
  // (failObjective sets it alongside outcome:'failed'): the terminal set says the contract has
  // nothing left to wait for, the succeeded set says whether it earned a payout. Passing only the
  // succeeded set - which is what this did - paid nobody and closed nothing when an objective
  // failed, leaving the quest open for the rest of the adventure.
  const terminalIds = new Set(ordered.filter((o) => o.reveal_state === 'completed').map((o) => o.id))
  const succeededIds = new Set(
    ordered.filter((o) => o.reveal_state === 'completed' && o.outcome !== 'failed').map((o) => o.id),
  )
  const questCompleted = await maybeResolveQuestForObjective(
    service, env, sessionId, completed.id, succeededIds, terminalIds,
  )

  // Surface the next thread in the fiction. completeQuest already narrated the reward + "what comes
  // next" beat, so on the quest path we do NOT recap the accomplishment again - but the new objective
  // still owes the player a reason it exists. Skipping that hook entirely is exactly how the climax
  // objective surfaced with no bridge (live 2026-07-22); a short forward-only beat is far better than
  // a silent reveal. When nothing new surfaced (next is null), the quest/final-objective resolution
  // narration stands alone.
  if (questCompleted) {
    // On a graph-bearing guide the tail is about to open the next objective's first authored node,
    // and that cutscene already carries this exact "a new thread draws them on" line (see
    // ensureSpineLoop's threadContext). Publishing here too puts three narrations on one turn -
    // the payout handover, this bridge, and the scene opening - all saying the same thing.
    const bridgeIsRedundant = next
      ? (await loadObjectiveNodes(service, env.adventureId, next.id)).length > 0
      : false
    if (next && !bridgeIsRedundant) {
      await narrationBeat(
        service, env, sessionId,
        `With that resolved, a new thread now draws the party on: "${next.title}". Do not restate it ` +
          `as a task or recap what just happened - surface it in the fiction and end at a concrete ` +
          `decision point.`,
        'Objective revealed',
      )
    }
    return true
  }

  await narrationBeat(
    service, env, sessionId,
    `The party just achieved "${completed.title}".` +
      (next
        ? ` Narrate the accomplishment briefly, then let the next thread surface naturally: "${next.title}". Do not state it as a task - surface it in the fiction.`
        : ' Narrate the accomplishment.') +
      ' End at a concrete decision point.',
    'Objective complete',
  )
  return false
}

/**
 * Why an objective is being retired unfinished. The two causes need different prose, and giving
 * them the same line was actively misleading (2026-07-27):
 *
 * - `stalled`  - the director timed out. The party never engaged; the chance passed them by.
 * - `spent`    - the party played every authored scene and lost them all. They are NOT told the
 *                chance passed: they were there, they fought for it, and it cost them. This is
 *                the Adventurers League failure box - you proceed to Part 2 with the alarm up.
 */
export type FailCause = 'stalled' | 'spent'

/**
 * Retire an objective the party could not finish and move the story on. Mirrors
 * completeObjective's ladder mechanics, but the outcome is 'failed' - which the ending signal
 * vocabulary has always accepted as {objective_id, outcome:'failed'}.
 *
 * On `spent` this is not a last resort at all - it is the ordinary bottom of the scene ladder and
 * the reason the spine cannot stall. On `stalled` it stays what it was: a genuine timeout
 * (full-AI only - assist gets a DM proposal instead).
 */
export async function failObjective(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  reason: string,
  cause: FailCause = 'stalled',
): Promise<boolean> {
  const ordered = await orderedObjectives(service, env.adventureId)
  const state = (await loadState(service, env.adventureId)).state
  const current = ordered.find((o) => o.id === state.objectives.currentId)
  if (!current || current.reveal_state !== 'active') return false

  // A MAIN OBJECTIVE CANNOT BE FAILED (2026-07-29).
  //
  // It is a plot point rendered for the player, not a challenge with a pass/fail: the story is
  // prewritten and linear, so it becomes true however the routes went. Only a `side` thread is
  // genuinely losable, and losing one only colours the story.
  //
  // In the normal case this branch never fires. The node's `establishes` credits the objective's
  // atoms when its FIRST route resolves, at any tier, so the predicate is satisfied long before
  // the routes run out and the ordinary completion path retires it. Reaching here means
  // `establishes` was empty - an objective whose predicate yields no minimal satisfying set, which
  // is a guide-authoring gap - so retire it as COMPLETED anyway and log the gap rather than strip
  // a fact the rest of the adventure is written against. That is what happened to objective 0 of
  // run 9a5f87a6 under the old coupling: retired `failed`, its plot atom never written, while
  // every setback fired.
  if ((current.kind ?? 'main') !== 'side') {
    const { data: claimed } = await service
      .from('objectives')
      .update({ reveal_state: 'completed', outcome: 'completed' })
      .eq('id', current.id).eq('reveal_state', 'active').select('id')
    if (!claimed || claimed.length === 0) return false // another pass retired it first
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'main_objective_routes_spent', objective_id: current.id, title: current.title, reason, cause,
    }).catch(() => {})
    await logEvent(service, env.adventureId, sessionId, 'objective_completed', {
      objective_id: current.id, title: current.title, evaluated: false, routes_spent: true,
    })
    const nextMain = ordered.find((o) => o.reveal_state === 'hidden' && o.id !== current.id)
    if (nextMain) {
      await service.from('objectives').update({ reveal_state: 'active' }).eq('id', nextMain.id)
      await logEvent(service, env.adventureId, sessionId, 'objective_revealed', {
        objective_id: nextMain.id, title: nextMain.title, after: 'routes_spent',
      })
    }
    await commitDiffs(service, env.adventureId, (s) => {
      const touched = new Set([current.id, ...(nextMain ? [nextMain.id] : [])])
      return [{
        domain: 'objectives',
        patch: {
          list: [
            ...s.objectives.list.filter((o) => !touched.has(o.id)),
            { id: current.id, title: current.title, state: 'completed' },
            ...(nextMain ? [{ id: nextMain.id, title: nextMain.title, state: 'active' }] : []),
          ],
          currentId: nextMain?.id ?? null,
        } as unknown as Json,
      }]
    }).catch(() => {})
    return true
  }

  if (env.mode !== 'full_ai') {
    // Assist: the human DM decides whether the story gives up on this thread.
    await recordProposal(service, {
      adventureId: env.adventureId,
      sessionId,
      type: 'objective_fail_forward',
      payload: { objective_id: current.id, title: current.title, reason },
      mode: 'human',
      summary: `Fail forward past: ${current.title}`,
    })
    return false
  }

  const { data: claimedFail } = await service
    .from('objectives').update({ reveal_state: 'completed', outcome: 'failed' })
    .eq('id', current.id).eq('reveal_state', 'active').select('id')
  if (!claimedFail || claimedFail.length === 0) return false // another pass retired it first
  await logEvent(service, env.adventureId, sessionId, 'objective_failed', {
    objective_id: current.id, title: current.title, reason, cause,
  })
  const next = ordered.find((o) => o.reveal_state === 'hidden' && o.id !== current.id)
  if (next) {
    await service.from('objectives').update({ reveal_state: 'active' }).eq('id', next.id)
    await logEvent(service, env.adventureId, sessionId, 'objective_revealed', {
      objective_id: next.id, title: next.title, after: 'failure',
    })
  }
  await commitDiffs(service, env.adventureId, (s) => {
    const touched = new Set([current.id, ...(next ? [next.id] : [])])
    const list = [
      ...s.objectives.list.filter((o) => !touched.has(o.id)),
      { id: current.id, title: current.title, state: 'failed' },
      ...(next ? [{ id: next.id, title: next.title, state: 'active' }] : []),
    ]
    const banner = cause === 'spent'
      ? `Won the hard way: ${current.title}`
      : `The moment passes: ${current.title}`
    return [
      appendLinesDiff(s, [newLine(null, null, banner)]),
      { domain: 'objectives', patch: { currentId: next?.id ?? null, list: list as unknown as Json } },
    ] as StateDiff[]
  })
  // A failure can be a quest's LAST word too. `ordered` predates the update above, so the objective
  // just retired is folded in by hand: terminal, never succeeded. Without this the contract that
  // held it would wait forever for an objective that is never coming back (live 2026-07-28) - and
  // the failure path is where that lands most often, since the last thing to resolve in a losing
  // run is usually a loss.
  const terminalIds = new Set(
    ordered.filter((o) => o.id === current.id || o.reveal_state === 'completed').map((o) => o.id),
  )
  const succeededIds = new Set(
    ordered
      .filter((o) => o.id !== current.id && o.reveal_state === 'completed' && o.outcome !== 'failed')
      .map((o) => o.id),
  )
  await maybeResolveQuestForObjective(service, env, sessionId, current.id, succeededIds, terminalIds, false)

  // The world took the win. An antagonist step makes the failure a real event rather than a
  // silent bookkeeping change.
  try {
    await antagonistTurn(service, env, sessionId, 'objective_failed')
  } catch (err) {
    console.error('fail-forward antagonist turn failed', err)
  }
  const opening = cause === 'spent'
    ? `The party threw everything they had at "${current.title}" and it was not enough. They are ` +
      'through it and moving on, but on the worst possible terms. Narrate the cost of getting ' +
      'this far - what the opposition gains, what closes off, who is worse for it - and give the ' +
      'party their due for trying. Never phrase it as a verdict on the players, and never say ' +
      'they walked away or let the chance pass; they were there for all of it.'
    : `The party never managed "${current.title}", and the chance has now passed them by. Narrate ` +
      'what that COSTS - what the opposition gains, what closes off, who is worse for it - as ' +
      'something that happens in the world, never as a verdict on the players.'
  await narrationBeat(
    service, env, sessionId,
    opening +
      (next
        ? ` Then let the next thread surface in the fiction: "${next.title}". Do not state it as a task.`
        : ' End on what is now at stake.') +
      ' End at a concrete decision point.',
    cause === 'spent' ? 'Hard-won ground' : 'The moment passes',
  )
  return true
}

/** Re-score candidate endings (deterministic, every pass) and commit when decisively led. */
async function updateEndings(service: SupabaseClient, env: AgentEnv, sessionId: string, state: GameState, ordered: ObjectiveRow[]): Promise<void> {
  const { data: adventureRow, error } = await service
    .from('adventures')
    .select('ending_scores, dial_values, committed_ending_id')
    .eq('id', env.adventureId)
    .single()
  assertOk(error, 'adventure load failed')
  if (adventureRow.committed_ending_id) return

  const { data: endingRows } = await service
    .from('endings')
    .select('id, index, title, description, climax_summary, tone, trigger_conditions, status')
    .eq('adventure_id', env.adventureId)
    .neq('status', 'discarded')
    .order('index')
  const endings = (endingRows ?? []) as { id: string; index: number; title: string; description: string; climax_summary: string | null; tone: string; trigger_conditions: Json; status: string }[]
  if (endings.length === 0) return

  const candidates: EndingCandidate[] = endings.map((e) => ({
    id: e.id,
    index: e.index,
    signals: parseEndingSignals(e.trigger_conditions),
  }))
  const world: EndingWorld = {
    // Phase 4: read the REAL outcome. This hardcoded 'completed' for every retired objective,
    // so an ending keyed on {outcome:'failed'} could never score even once failObjective
    // started producing them - the tragic/pyrrhic endings would have been unreachable.
    objectiveOutcomes: Object.fromEntries(
      ordered
        .filter((o) => o.reveal_state === 'completed')
        .map((o) => [o.id, o.outcome === 'failed' ? ('failed' as const) : ('completed' as const)]),
    ),
    npcStates: await endingNpcStates(service, env.adventureId, state),
    dialValues: (adventureRow.dial_values ?? {}) as Record<string, number>,
    // The last rung of the ladder is the climax, and an ending that CLAIMS a climax outcome the
    // party did not produce is not a candidate - however well its side signals score. Live
    // 2026-07-27 the climax was failed and "The Light Restored" still landed, 7 to 5, over the
    // tragedy whose {climax, failed} signal actually fired. See scoreEndings in endings.ts.
    ...(ordered.length > 0 ? { climaxObjectiveId: ordered[ordered.length - 1].id } : {}),
  }
  const { scores, leadingId, contradictedIds, vetoFallback, refutedCounts, eligibleScores } =
    scoreEndings(candidates, world)

  const previousLeading = endings.find((e) => e.status === 'leading')?.id ?? null
  // `scores` stays the RAW sum so stored ending_scores remain comparable run to run; only
  // eligibility moved.
  await service.from('adventures').update({ ending_scores: scores as unknown as Json }).eq('id', env.adventureId)
  if (leadingId && leadingId !== previousLeading) {
    if (previousLeading) await service.from('endings').update({ status: 'candidate' }).eq('id', previousLeading)
    await service.from('endings').update({ status: 'leading' }).eq('id', leadingId)
    await logEvent(service, env.adventureId, sessionId, 'ending_leading_changed', {
      from: previousLeading, to: leadingId, scores: scores as unknown as Json,
      contradicted: contradictedIds as unknown as Json, veto_fallback: vetoFallback,
      // Why this one leads: the accuracy tier decides before the score does, so the score alone
      // no longer explains the pick.
      refuted: refutedCounts as unknown as Json, eligible: eligibleScores as unknown as Json,
    })
  }

  // Commitment (F08 SS8.1): late on this ladder + decisive margin + enough recorded play.
  const ladder = {
    total: ordered.length,
    remaining: ordered.filter((o) => o.reveal_state !== 'completed').length,
  }
  // Phase 4: every objective is terminal, so there is nothing left to play toward - the story
  // MUST end here even if no ending pulled decisively clear (a run that fail-forwarded its way
  // down the ladder can finish with a muddy score and would otherwise just stop).
  const allTerminal = ladder.total > 0 && ladder.remaining === 0
  if (!leadingId || (!ladderReady(ladder) && !allTerminal)) return
  const { count } = await service
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId)
  // Judged on the ELIGIBLE field: a contradicted ending must not deny the honest one its margin.
  if (!allTerminal && !commitmentReady(eligibleScores, leadingId, count ?? 0, ladder)) return
  if (allTerminal) {
    await logEvent(service, env.adventureId, sessionId, 'ending_forced', {
      reason: 'all objectives terminal', scores: scores as unknown as Json,
      contradicted: contradictedIds as unknown as Json, veto_fallback: vetoFallback,
      refuted: refutedCounts as unknown as Json, eligible: eligibleScores as unknown as Json,
    }).catch(() => {})
  }

  const leading = endings.find((e) => e.id === leadingId)!
  if (env.mode !== 'full_ai') {
    await recordProposal(service, {
      adventureId: env.adventureId,
      sessionId,
      type: 'ending_commitment',
      payload: { ending_id: leadingId, scores: scores as unknown as Json },
      mode: 'human',
      summary: `Commit ending: ${leading.title}`,
    })
    return
  }
  // Full-AI auto-commit only on a clean Consistency pass (no contradicting established facts).
  const npcs = await service.from('npcs').select('id, name').eq('adventure_id', env.adventureId)
  const verdict = await runConsistency(
    env, `${leading.title}: ${leading.description}`,
    ((npcs.data ?? []) as { id: string; name: string }[]),
    state.dm?.facts.npcStates ?? {}, '',
  )
  if (!verdict.ok) {
    await logEvent(service, env.adventureId, sessionId, 'ending_commit_blocked', {
      ending_id: leadingId, violations: verdict.violations as unknown as Json,
    })
    return
  }
  // CLAIM the commit atomically - only the pass that actually flips committed_ending_id from
  // null goes on to publish. The read-then-write guard at the top of this function is not
  // enough: several progress passes overlap (head, tail, director), they all read null, and
  // they all commit. Live 2026-07-24, heist: `ending_committed` fired three times and the
  // player was handed the same ending prose three times over.
  const { data: claimed } = await service
    .from('adventures')
    .update({ committed_ending_id: leadingId })
    .eq('id', env.adventureId)
    .is('committed_ending_id', null)
    .select('id')
  if (!claimed || claimed.length === 0) return // another pass already committed this ending
  await service.from('endings').update({ status: 'committed' }).eq('id', leadingId)
  await service.from('endings').update({ status: 'discarded' }).eq('adventure_id', env.adventureId).neq('id', leadingId).neq('status', 'committed')
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'ending_commitment',
    payload: { ending_id: leadingId, scores: scores as unknown as Json },
    mode: 'auto',
    summary: `Ending committed: ${leading.title}`,
  })
  await logEvent(service, env.adventureId, sessionId, 'ending_committed', {
    ending_id: leadingId, title: leading.title, scores: scores as unknown as Json,
  })

  // Present the ending to the PLAYER. This is the payoff of the entire adventure and it must
  // land - so it does not depend on one more fragile LLM call surviving.
  //
  // It used to route through publishNarration, which RE-RUNS the narrator on the climax: a
  // second heavy agent call at the very end of the app's longest tail. When that worker hit its
  // resource limit the call threw, the tail's outer catch swallowed it, and the story simply
  // STOPPED mid-scene - a committed ending in the database, zero climax narration, the last
  // line the player saw an unrelated beat. Live 2026-07-24: both the heist ("Justice Served")
  // and the court ("The Triumvirate") committed and neither published a word of their ending.
  //
  // runClimaxAuthor already returns finished prose (with its own fallback), so publish it
  // DIRECTLY - one light DB write instead of a fresh narrator pass. The ending's authored
  // climax_summary is the guaranteed floor if even the author call came back empty.
  const { data: recent } = await service
    .from('event_log')
    .select('type, payload')
    .eq('adventure_id', env.adventureId)
    .order('id', { ascending: false })
    .limit(40)
  const condensed = ((recent ?? []) as { type: string; payload: Record<string, Json> }[])
    .reverse()
    .map((e) => `${e.type}: ${['text', 'title', 'tag', 'name'].map((k) => e.payload[k]).filter((v) => typeof v === 'string').join(' ')}`)
  const personalOutcomes = await personalEpilogueLines(service, env.adventureId).catch(() => [])
  let climax = (await runClimaxAuthor(
    env, { title: leading.title, description: leading.description, tone: leading.tone }, condensed,
    personalOutcomes,
    // Nothing left to play: this prose is the adventure's final line, not the opening of a finale
    // the party still has to fight through. The two need opposite endings.
    ladder.remaining === 0,
    // The authored record of the story, and what became of each objective (2026-07-29). This agent
    // used to see only the condensed event trail above - type names with a few fields glued on.
    await establishedSoFar(service, env.adventureId).catch(() => []),
    ordered.map((o) => `${o.title}: ${o.outcome ?? (o.reveal_state === 'completed' ? 'completed' : o.reveal_state)}`),
  ).catch(() => '')) || leading.climax_summary || leading.description

  // Consistency, cheaply and deterministically. Publishing the climax directly (above) removed
  // its old consistency pass along with the fragile double-narrator that caused the disappearing
  // ending - a real gap, since a live-authored climax could put words in a dead mouth or stage
  // someone who left. Run only the STRUCTURAL claim check (a dead/absent NPC speaking or acting),
  // which is code-decided and cannot itself misfire; if it flags the live prose, fall back to the
  // guide's climax_summary, which was consistency-checked at authoring time. No LLM re-narration,
  // so the ending still reliably lands.
  const { data: npcRows } = await service
    .from('npcs').select('id, name').eq('adventure_id', env.adventureId)
  const roster = ((npcRows ?? []) as { id: string; name: string }[])
    .map((n) => ({ id: n.id, name: n.name, state: state.dm?.facts.npcStates?.[n.id] ?? 'alive' }))
  const { violations } = await runClaimCheck(env, climax, roster)
  // Characters outside the adventure's language (2026-07-28). This text does NOT go through
  // publishNarration, so the guard there never sees it - and it is the one line every run is
  // guaranteed to end on. Same remedy as a claim-check violation: fall back to climax_summary,
  // which the guide pipeline charset-gated at authoring time.
  const foreign = foreignCharacters(climax)
  if (violations.length > 0 || foreign.length > 0) {
    await logEvent(service, env.adventureId, sessionId, 'ending_climax_reauthored', {
      ending_id: leadingId,
      violations: violations.map((v) => `${v.name} (${v.state})`),
      characters: foreign.slice(0, 8).join(' '),
    }).catch(() => {})
    climax = leading.climax_summary || leading.description
  }
  // A guide authored before that gate existed can carry the same defect in its stored summary,
  // and there is no third fallback - remove whatever survives rather than publish it.
  const endingText = stripForeign(`${leading.title}\n\n${climax}`)
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(null, null, endingText)]), typingDiff(false),
  ])
  await logEvent(service, env.adventureId, sessionId, 'narration_published', {
    text: endingText, source: 'ending_climax',
  })
  // THE WORLD STOPS TALKING (2026-07-28). Until now nothing marked the story finished, so whatever
  // was still in flight kept narrating past the epilogue: live, the player read the closing text
  // and then two more beats of an adventure that had already ended ("The flame catches the page's
  // corner, but the phosphorescent ink fights back...").
  //
  // SESSION-scoped on purpose. Marking the ADVENTURE terminal is the larger change that was
  // deferred here for real reasons - the $0 suite commits an ending mid-run and keeps testing
  // seven more sections on the same adventure, and a hard terminal guard would 410 all of them.
  // Scoped to the session, the suppression covers exactly the leak (everything after the epilogue,
  // in the session that produced it) and a later session on the same adventure narrates normally.
  await commitDiffs(service, env.adventureId, () => [
    { domain: 'dm', patch: { story: { endedSessionId: sessionId } } },
  ]).catch(() => {})

  // NOTE: marking the adventure terminal (status -> 'completed') and refusing further play is
  // deferred. It has real blast radius - the $0 story-live suite commits an ending mid-run and
  // keeps testing, so a hard terminal guard 410s the rest of the suite - and it belongs with the
  // climax-beat design under review (2026-07-24), not bolted on here. The ending PROSE now
  // reaches the player, which was the load-bearing gap; "the world stops after the ending" is a
  // separate, larger change.
  await logEvent(service, env.adventureId, sessionId, 'adventure_ended', {
    ending_id: leadingId, title: leading.title,
  })
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined

/**
 * Hand the pass's heavy tail to a FRESH worker (same pattern as guide-pipeline's `kick`).
 * WORKER_RESOURCE_LIMIT is a per-worker ceiling, not a timeout, so deferring within the same
 * worker would not help - only a new invocation gets a new budget.
 */
/**
 * Could this env hand its tail off at all? Demo adventures run canned agents - no cost, no
 * resource pressure - and the $0 suites assert immediately after each intent, so deferring there
 * would only introduce a race. Without service credentials there is nothing to call.
 */
function canKickTail(env: AgentEnv): boolean {
  return !env.demo && Boolean(SUPABASE_URL) && Boolean(SUPABASE_SERVICE_ROLE_KEY)
}

/**
 * Tails waiting for their request to stop narrating (2026-07-29). See `parkTail`.
 *
 * A QUEUE, not a slot. The edge runtime reuses an isolate across requests, so a single slot could
 * be overwritten by a second request and silently drop a tail - and a lost tail costs a beat
 * re-plan and an ending score. Draining a list cannot lose one. The residual race is that request
 * B's flush may fire a tail A parked moments earlier; that still fires the RIGHT tail, since each
 * carries its own env, session and context, just marginally early - which remains strictly better
 * than the old behaviour of firing it before the narration instead of after.
 */
const parkedTails: { env: AgentEnv; sessionId: string; ctx: TailContext }[] = []

/**
 * Defer the tail until the REQUEST is finished, not merely the head (2026-07-29).
 *
 * `runStoryProgressHead` used to end with `if (kickTail(...)) return`, and returning from the head
 * is not the same as the request being over: `evaluateStoryProgress` has 11 call sites and every
 * one of them keeps working afterwards, holding an env that now says `tailKicked`. So the caller
 * narrated while a second worker was already drafting the next scene, and neither could see the
 * other. Measured: 20 narration pairs under 9s apart across seven runs, and 34
 * `narration_after_tail_kick` incidents naming the offenders - 12 the director rung, 9 the climax,
 * 6 an encounter close. director.ts alone kicks at rung >= 2 and then runs four narrating paths.
 *
 * Parking costs nothing. Nobody waits on the tail - it is background bookkeeping - so the only
 * price is that the next scene starts being drafted a little later.
 *
 * Repeat parks for the same session MERGE rather than queue twice: several call sites can run a
 * progress pass in one turn, and the tail is one "catch the story up" job, not one per pass.
 */
function parkTail(env: AgentEnv, sessionId: string, ctx: TailContext): void {
  const existing = parkedTails.find((p) => p.env.adventureId === env.adventureId && p.sessionId === sessionId)
  if (!existing) {
    parkedTails.push({ env, sessionId, ctx })
    return
  }
  existing.ctx = {
    objectiveJustCompleted: existing.ctx.objectiveJustCompleted || ctx.objectiveJustCompleted,
    questJustCompleted: existing.ctx.questJustCompleted || ctx.questJustCompleted,
    // The rung that asked most recently is what the recognition judge should hear about.
    recognitionRung: ctx.recognitionRung ?? existing.ctx.recognitionRung ?? null,
  }
}

/**
 * Fire every parked tail. Called once the request has published everything it is going to.
 *
 * Synchronous by design: `kickTail` registers its own `EdgeRuntime.waitUntil`, so this has to run
 * while the worker is still alive - i.e. from a `finally`, before the Response is delivered.
 */
export function flushParkedTails(): void {
  const due = parkedTails.splice(0, parkedTails.length)
  for (const p of due) kickTail(p.env, p.sessionId, p.ctx)
}

function kickTail(env: AgentEnv, sessionId: string, ctx: TailContext): boolean {
  if (!canKickTail(env)) return false
  const request = fetch(`${SUPABASE_URL}/functions/v1/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    // THE HEAD'S CONTEXT TRAVELS WITH IT (2026-07-27). The body used to carry only the ids, so
    // every flag the head computed died at this boundary - and since kickTail returns true for
    // every non-demo adventure, that is ALL real play. `recognitionRung` (the director's escalation
    // asking "did the fiction already do this?") only ever reached the judge in demo mode, and
    // `questJustCompleted` was silently false in the tail, defeating the 2026-07-21 guard.
    body: JSON.stringify({
      action: 'story_progress_tail',
      adventure_id: env.adventureId,
      session_id: sessionId,
      objective_just_completed: ctx.objectiveJustCompleted,
      quest_just_completed: ctx.questJustCompleted,
      recognition_rung: ctx.recognitionRung ?? null,
    }),
  })
    .then(async (res) => {
      // A lost tail costs this pass its beat re-plan and its ending scoring, and until now said so
      // only to `console.error` - invisible to the event log, so every analysis of a stalled run
      // has had to guess whether the tail ran at all. It is NOT retried here: awaiting or falling
      // back inline would hold `typing` across the tail and reject every turn arriving behind it
      // (the 2026-07-21 failure, 6 of 26 turns lost). The director re-plans on the next turn; this
      // just makes the loss measurable so it can be judged on evidence rather than suspicion.
      if (!res.ok) {
        await logEvent(env.service, env.adventureId, sessionId, 'incident', {
          kind: 'tail_kick_failed', status: res.status,
        }).catch(() => {})
      }
      return res
    })
    .catch(async (err) => {
      console.error('story tail kick failed', err)
      await logEvent(env.service, env.adventureId, sessionId, 'incident', {
        kind: 'tail_kick_failed', error: String(err instanceof Error ? err.message : err).slice(0, 200),
      }).catch(() => {})
    })
  const grace = new Promise((resolve) => setTimeout(resolve, 3000))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(Promise.race([request, grace]))
  }
  // From here a SECOND narrator is drafting the next scene in another worker. publishNarration
  // reports anything this request still writes, because the two cannot see each other.
  env.tailKicked = true
  return true
}

/**
 * The story-progress pass: called after checks resolve, world facts change, quests complete,
 * and on DM story commands. Deterministic except the narration it triggers.
 *
 * The pass usually runs right after a publish cleared dialogue.typing, yet it carries the
 * longest agent chains in the app (beat re-plans, the Encounter Designer, ending
 * commitment) - the table read as stuck during that window (playtest 2026-07-20). Hold the
 * typing flag for the whole pass; intermediate publishes clear it and the finally re-clears
 * idempotently.
 *
 * Those chains also blew the worker's resource ceiling outright: ~19% of player turns came back
 * 546 in the multi-chapter playtest (2026-07-20), and a dial pass was silently lost when the
 * worker died before reaching it. The pass is therefore split - the deterministic head runs
 * inline (the player's turn depends on it), and the agent-heavy tail runs in its own worker.
 *
 * The typing flag is released as soon as the HEAD is done, never held across the tail. Holding
 * it turned every turn that arrived mid-tail into a 409 "the DM is thinking" - 6 of 26 turns
 * were rejected outright and their input vanished (one-shot playtest 2026-07-21). The tail is
 * background bookkeeping (beat re-plan, ledger, ending scores); the player is not waiting on
 * it, and anything it publishes raises typing for its own short window.
 */
export async function evaluateStoryProgress(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  opts?: { recognitionRung?: number | null },
): Promise<void> {
  await commitDiffs(service, env.adventureId, () => [typingDiff(true)]).catch(() => {})
  try {
    await runStoryProgressHead(service, env, sessionId, opts?.recognitionRung ?? null)
  } finally {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
  }
}

/**
 * Has the active objective resolved, and how? `null` means "still in play".
 *
 * GRAPH-BEARING GUIDES (2026-07-27) - the authored scene ladder is the authority. An objective
 * resolves because a scene resolved, never because a bag of flags added up. Winning any authored
 * scene completes it; running out of scenes retires it as `failed`, which advances the story just
 * as a win does. This is the Adventurers League model, and it is what makes the spine unstallable:
 * `nextNode` answers `open` or `resolve` and nothing else, so there is no third state to hang in.
 *
 * Completion used to be INFERRED here - `evaluatePredicate` over a world fact base, against a
 * predicate stage 3 authored two stages before the nodes existed and stage 7 could rewrite. Every
 * mismatch along that chain was an objective that could never complete, or a guide that could
 * never generate. The predicate is no longer read for these guides at all.
 *
 * LEGACY GUIDES (no authored nodes) keep the predicate path unchanged - 60-odd stored adventures
 * still run on it, and they have no scene ladder to consult.
 */
async function objectiveOutcome(
  service: SupabaseClient,
  adventureId: string,
  current: ObjectiveRow,
  world: WorldFacts,
  encounterOpen: boolean,
): Promise<'completed' | 'failed' | null> {
  const nodes = await loadObjectiveNodes(service, adventureId, current.id)

  // LEGACY GUIDES: the predicate decides, and it is independent of what is on the table. An
  // objective whose atoms are all true is complete whether or not a scene happens to be open.
  if (nodes.length === 0) {
    return evaluatePredicate(current.completion_predicates, world) ? 'completed' : null
  }

  // GRAPH-BEARING GUIDES: the scene ladder decides, and both guards below belong to it alone.
  //
  // They exist for one reason: `used` is written when a beat is INSERTED, so a node the party has
  // not played yet already looks spent to the navigator. Ask it mid-scene and it reports the
  // ladder exhausted and retires the objective out from under them.
  //
  // These sat above the legacy branch when first written and blocked predicate completion for
  // every stored adventure whenever any encounter was live - a graph-shaped guard applied to a
  // model that has no nodes and no `used` to be confused by. story-live caught it twice before I
  // stopped calling it a flake.
  if (encounterOpen) return null
  if (await inPlayNodeKey(service, adventureId, nodes)) return null

  const read = await graphDecision(service, adventureId, current.id)
  return read?.decision.action === 'resolve' ? read.decision.outcome : null
}

/**
 * The deterministic head: objective completion + its narration. The player's turn depends on
 * this being visible immediately, and it costs at most one narration call. The agent-heavy tail
 * is handed to a fresh worker when one is available, and runs inline otherwise.
 */
async function runStoryProgressHead(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  recognitionRung: number | null,
): Promise<void> {
  // 1. Active objective completion (F08 SS9).
  // Loops, because the vocabulary now looks one objective ahead: by the time an objective becomes
  // current its atoms may ALREADY be satisfied, and evaluating once per turn would dribble out
  // one completion per turn while the party waits for credit they earned several turns ago.
  // Bounded at 3 - each completion narrates, and three at once is already a lot of story to land
  // in one beat. Everything is re-read each pass: completeObjective moves currentId and flips
  // reveal_state in the database, so an in-memory snapshot from before it ran is stale.
  let objectiveJustCompleted = false
  let questJustCompleted = false
  for (let pass = 0; pass < 3; pass++) {
    const state = (await loadState(service, env.adventureId)).state
    const events = await storyEventTags(service, env.adventureId)
    const world = worldFacts(state, events)
    const ordered = await orderedObjectives(service, env.adventureId)
    const current = ordered.find((o) => o.id === state.objectives.currentId)
    if (!current || current.reveal_state !== 'active') break

    const outcome = await objectiveOutcome(service, env.adventureId, current, world, Boolean(state.encounter))
    if (!outcome) break
    if (outcome === 'failed') {
      // The scene ladder bottomed out. In assist mode this only records a proposal and leaves the
      // objective active, so stop the loop rather than re-proposing twice more on the same pass.
      const retired = await failObjective(service, env, sessionId, 'every authored scene was played and lost', 'spent')
      if (!retired) break
      objectiveJustCompleted = true
      continue
    }
    questJustCompleted = (await completeObjective(service, env, sessionId, current, ordered, world)) || questJustCompleted
    objectiveJustCompleted = true
  }

  const ctx: TailContext = { objectiveJustCompleted, questJustCompleted, recognitionRung }
  // PARK, do not kick - see parkTail. The head returning is not the request being over, and
  // everything this caller still narrates would otherwise race the tail worker.
  if (canKickTail(env)) {
    parkTail(env, sessionId, ctx)
    return
  }
  // Demo and credential-less paths keep running the tail INLINE, exactly as before: it is
  // synchronous, so it cannot collide with anything, and the $0 suites assert on it immediately.
  await runStoryProgressTail(service, env, sessionId, ctx)
}

export interface TailContext {
  objectiveJustCompleted: boolean
  questJustCompleted: boolean
  /**
   * The director rung that asked for this pass, or null. Non-null means "you are escalating, so
   * ask the recognition judge whether the fiction already did the deed" - see the judge's own
   * comment. Carries the RUNG rather than a boolean so the judge can be capped to one call per
   * (objective, rung) instead of firing on every escalation.
   */
  recognitionRung?: number | null
}

/**
 * The agent-heavy tail: beat re-plan (beat planner + Encounter Designer), re-weave, the dial
 * pass, and ending scoring/commitment (consistency + climax author + narration). Recomputes its
 * own world state so it is safe to run in a fresh worker.
 *
 * It deliberately does NOT touch the typing flag. The head releases it, and by the time the
 * tail finishes a later player turn may legitimately own it - clearing it here would tell the
 * table an agent call in flight had finished. Anything the tail publishes raises and clears
 * typing for its own short window.
 */
export async function runStoryProgressTail(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  ctx: TailContext,
): Promise<void> {
  try {
    const state = (await loadState(service, env.adventureId)).state
    const events = await storyEventTags(service, env.adventureId)
    const world = worldFacts(state, events)
    const ordered = await orderedObjectives(service, env.adventureId)

    // The head's own values, carried across the worker boundary by kickTail. This used to be
    // recovered by scanning the event log, because the kick body carried no context at all - a
    // heuristic that could not see `questJustCompleted` in the first place and, whenever a re-plan
    // was skipped, kept reporting true on every later turn.
    const { objectiveJustCompleted, questJustCompleted } = ctx

    // 2. Open beat exit conditions -> the next beat opens (event-driven pacing, F08 SS9.1).
    // A completed objective also forces a re-plan: the old beat's encounter spec and outcome
    // vocabulary belong to the finished objective, and leaving it open re-offers a stale
    // encounter forever (seen in the story sim, 2026-07-19). Skip the forced re-plan when the
    // objective closed a whole quest: its loop is done and completeQuest may have resumed a
    // suspended loop whose preserved beat we must not discard - only its own exit predicate reopens it.
    const loops = await loadLoops(service, env.adventureId)
    const currentObjectiveId = state.objectives.currentId ?? null
    // An active objective with nothing on the stack cannot be given a beat at all - the shape that
    // cost a live run its climax. Opening the loop here, on the pass that noticed, is what keeps
    // the spine playable across a quest boundary. See beats.ts ensureSpineLoop.
    const spine = await ensureSpineLoop(service, env, sessionId, loops, currentObjectiveId)
    const loop = spine.loop
    if (spine.created && loop) {
      const title = ordered.find((o) => o.id === currentObjectiveId)?.title ?? ''
      try {
        await planAndOpenBeat(
          service, env, sessionId, loop.id, 'objective_revealed',
          title
            ? `A new thread now draws the party on: "${title}". Surface it in the fiction rather ` +
              'than restating it as a task.'
            : undefined,
        )
      } catch (err) {
        console.error('spine beat open failed', err)
        await logEvent(service, env.adventureId, sessionId, 'incident', {
          kind: 'beat_open_failed', trigger: 'spine_continues',
          error: String(err instanceof Error ? err.message : err).slice(0, 300),
        }).catch(() => {})
      }
    } else if (loop?.currentBeatId) {
      const { data: beat } = await service
        .from('beats')
        .select('id, exit_conditions, status, encounter_spec, node_id')
        .eq('id', loop.currentBeatId)
        .maybeSingle()
      const exitMet = beat?.status === 'active' && beat.exit_conditions && evaluatePredicate(beat.exit_conditions, world)
      // A SPENT beat also forces a re-plan. Every beat carries exactly one encounter - the
      // planner's own words: "the ONLY way this beat can resolve". When that encounter resolves
      // without satisfying the exit predicate (a failed roll, a missed opportunity), the beat can
      // never exit and nothing above would ever re-plan it: the party is left with a live beat
      // that has no remaining route, and the story simply stops. Live 2026-07-21, court: "the
      // opportunity to deliver messages has passed", then 18 turns of conversation against a dead
      // beat, 5 auto-hints pointing at an action no longer on offer, 0 objectives. Failing an
      // encounter must cost the party something, never the story itself.
      // Phase 3: one liveness authority (route-health.ts). beatHasNoRouteLeft could only see a
      // beat whose encounter OPENED and resolved - it was structurally blind to an encounter
      // that can never open, which is how a stillborn social beat froze a story permanently.
      const health = beat?.status === 'active'
        ? await beatRouteHealth(service, {
            adventureId: env.adventureId,
            beatId: beat.id as string,
            beatStatus: beat.status as string,
            encounterSpec: (beat as { encounter_spec?: Json }).encounter_spec ?? null,
            state,
            turnsSinceBeatOpened: state.dm?.story?.director?.turnsSinceProgress ?? 0,
          })
        : 'missing'
      const beatSpent = !exitMet && (health === 'spent' || health === 'stillborn')
      const trigger = exitMet ? 'beat_exit' : beatSpent ? 'beat_spent' : 'objective_completed'
      // NODE-AWARE (2026-07-27). The `!questJustCompleted` guard exists for a real case: a quest
      // closing may RESUME a suspended loop whose preserved beat must not be discarded (2026-07-21).
      // But on a graph-bearing guide a beat is bound to one objective's node, so once that
      // objective is retired the beat is stale whether or not a quest closed with it - and leaving
      // it in place is how the next objective inherits a scene that can never serve it.
      const beatNodeId = (beat as { node_id?: string | null } | null)?.node_id ?? null
      const currentNodeIds = new Set(
        currentObjectiveId
          ? (await loadObjectiveNodes(service, env.adventureId, currentObjectiveId)).map((n) => n.id)
          : [],
      )
      const staleNode = beatNodeId !== null && !currentNodeIds.has(beatNodeId)
      const replanOnCompletion = objectiveJustCompleted && beat?.status === 'active' &&
        (staleNode || (beatNodeId === null && !questJustCompleted))
      if (exitMet || beatSpent || replanOnCompletion) {
        await logEvent(service, env.adventureId, sessionId, 'beat_exit_met', {
          beat_id: beat!.id, ...(exitMet ? {} : { reason: trigger }),
        })
        try {
          await planAndOpenBeat(service, env, sessionId, loop.id, exitMet ? 'beat_exit' : 'objective_completed')
        } catch (err) {
          console.error('beat re-plan failed', err)
          await logEvent(service, env.adventureId, sessionId, 'incident', {
            kind: 'beat_open_failed', trigger,
            error: String(err instanceof Error ? err.message : err).slice(0, 300),
          })
        }
      }

      // Recognition judge: a beat just resolved and the deterministic path credited nothing -
      // ask whether the FICTION already completed the current objective (the DM's "yeah, that
      // did it", for routes the authored atoms never anticipated). Gated on structural facts
      // only (beat exit/spent, objective active with atoms), never on word signals; at most one
      // call per beat resolution. Shadow first: log the verdict + evidence, act on nothing,
      // until a paid sweep shows the evidence holds up (same discipline as the 0.2 diagnostic).
      // `forceRecognition` breaks a circle. The judge fired only on beat exit or spend, which
      // assumes a beat that ends - and the case that most needs it is a beat that never does.
      // Live 2026-07-24 (The Wintering House): obj0 wanted the event "party encountered elara",
      // the party sat in a social encounter WITH Elara five separate times, and the beat never
      // exited because the objective was never credited. The judge that exists to notice
      // exactly this was waiting for the beat to exit. 30 turns, 1 beat, 0 milestones, aborted.
      // The Progress Director now calls this when it escalates, so a stuck beat is a REASON to
      // ask "did the fiction already do it?" rather than a reason never to ask.
      //
      // NOT RUN ON GRAPH-BEARING GUIDES (2026-07-27). The judge exists because a completion
      // predicate can miss - the fiction does the deed, the authored atoms never anticipated that
      // phrasing, and the objective sits open. Objectives now resolve because a scene resolved, so
      // there is no miss for it to catch: crediting an atom cannot complete anything, and the call
      // would be a paid LLM roll of the dice with no effect on progression. Legacy guides still
      // run on predicates and still need it.
      //
      // ONE CALL PER (OBJECTIVE, RUNG) (2026-07-27). Until now `forceRecognition` never survived the
      // tail's worker hop at all, so the escalation path was dead in real play; plumbing it through
      // would otherwise have fired a paid judge call on EVERY escalating pass at the same rung.
      const graphBearing = state.objectives.currentId
        ? (await graphDecision(service, env.adventureId, state.objectives.currentId)) !== null
        : false
      const escalationRung = ctx.recognitionRung ?? null
      const alreadyAsked = escalationRung !== null && state.objectives.currentId
        ? ((await service
            .from('event_log')
            .select('id')
            .eq('adventure_id', env.adventureId)
            .eq('type', 'objective_recognized')
            .eq('payload->>objective_id', state.objectives.currentId)
            .eq('payload->>rung', String(escalationRung))
            .limit(1)).data ?? []).length > 0
        : false
      if ((exitMet || beatSpent || (escalationRung !== null && !alreadyAsked)) &&
        !objectiveJustCompleted && !graphBearing) {
        const current = ordered.find((o) => o.id === state.objectives.currentId)
        const atoms = current && current.reveal_state === 'active'
          ? listMilestoneAtoms(current.completion_predicates)
          : null
        const atomList = atoms ? [...atoms.flags, ...atoms.events, ...atoms.facts] : []
        if (current && atomList.length > 0) {
          const recentLines = (state.dialogue?.lines ?? [])
            .slice(-14)
            .map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`)
          const verdict = await runObjectiveJudge(env, {
            objective: { title: current.title, hiddenDescription: current.hidden_description ?? '' },
            atoms: atomList,
            recentLines,
          })
          if (verdict) {
            await logEvent(service, env.adventureId, sessionId, 'objective_recognized', {
              objective_id: current.id,
              title: current.title,
              trigger: exitMet ? 'beat_exit' : beatSpent ? 'beat_spent' : 'director_escalation',
              rung: escalationRung,
              completed: verdict.completed,
              atom: verdict.atom,
              evidence: verdict.evidence,
              mode: OBJECTIVE_JUDGE_APPLIES ? 'live' : 'shadow',
            }).catch(() => {})
            if (OBJECTIVE_JUDGE_APPLIES && verdict.completed && verdict.atom) {
              // Credit flows through the SAME validated, idempotent machinery as every other
              // milestone writer - the judge picks the atom, applyMilestones stays the authority.
              await applyMilestones(service, env, sessionId, [verdict.atom], 'objective_judge')
            }
          }
        }
      }
    }

    // 3. Declined offers may re-weave once enough play has passed (F08 SS6).
    await maybeReweaveDeclined(service, env, sessionId)

    // 4. Ending scoring + (late, decisive) commitment (F08 SS8.1).
    const refreshed = (await loadState(service, env.adventureId)).state
    await updateEndings(service, env, sessionId, refreshed, await orderedObjectives(service, env.adventureId))
  } catch (err) {
    // Background bookkeeping: a failed tail must never surface to the player mid-turn.
    console.error('story progress tail failed', err)
  }
}

