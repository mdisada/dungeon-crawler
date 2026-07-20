// F08 SS9 + SS8.1: the deterministic story-progress pass. Evaluates the active objective's
// completion predicate and the open beat's exit conditions against the world fact base,
// advances the reveal order, re-scores candidate endings on every pass (an Engine, not an
// LLM), and drafts the commitment when one ending pulls decisively clear near the climax.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { GameState, Json, StateDiff } from '../_shared/state/index.ts'
import {
  activeLoop, commitmentReady, evaluatePredicate, ladderReady, parseEndingSignals, scoreEndings,
} from '../_shared/story/index.ts'
import type { EndingCandidate, EndingWorld, WorldFacts } from '../_shared/story/index.ts'
import { runConsistency } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { loadLoops, planAndOpenBeat } from './beats.ts'
import { runDialPass } from './dials.ts'
import { recordSceneLedger } from './ledger.ts'
import { narrationBeat, publishNarration } from './narration.ts'
import { appendLinesDiff, newLine, typingDiff } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { maybeCompleteQuestForObjective, maybeReweaveDeclined } from './story.ts'
import { runClimaxAuthor } from './story-agents.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

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
  completion_predicates: Json
}

async function orderedObjectives(service: SupabaseClient, adventureId: string): Promise<ObjectiveRow[]> {
  const [{ data: chapters }, { data: objectives }] = await Promise.all([
    service.from('chapters').select('id, index').eq('adventure_id', adventureId).order('index'),
    service.from('objectives').select('id, chapter_id, index, title, reveal_state, completion_predicates').eq('adventure_id', adventureId),
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
): Promise<boolean> {
  await recordSceneLedger(service, env, sessionId, 'objective', completed.title)
  await service.from('objectives').update({ reveal_state: 'completed' }).eq('id', completed.id)
  await logEvent(service, env.adventureId, sessionId, 'objective_completed', {
    objective_id: completed.id, title: completed.title, evaluated: true,
  })
  const next = ordered.find((o) => o.reveal_state === 'hidden' && o.id !== completed.id)
  if (next) {
    await service.from('objectives').update({ reveal_state: 'active' }).eq('id', next.id)
    await logEvent(service, env.adventureId, sessionId, 'objective_revealed', { objective_id: next.id, title: next.title })
  }
  await commitDiffs(service, env.adventureId, (s) => {
    const list = [
      ...s.objectives.list.filter((o) => o.id !== completed.id && o.id !== next?.id),
      { id: completed.id, title: completed.title, state: 'completed' },
      ...(next ? [{ id: next.id, title: next.title, state: 'active' }] : []),
    ]
    const diffs: StateDiff[] = [
      appendLinesDiff(s, [newLine(null, null, `Objective complete: ${completed.title}`)]),
      { domain: 'objectives', patch: { currentId: next?.id ?? null, list: list as unknown as Json } },
    ]
    return diffs
  })

  // If this was the last open objective of an accepted quest's contract, close the quest
  // (loop complete + one-time payout). completeQuest already narrates the resolution, so a
  // second objective-complete beat would double up - let its narration stand alone.
  const completedIds = new Set(ordered.filter((o) => o.reveal_state === 'completed').map((o) => o.id))
  completedIds.add(completed.id)
  const questCompleted = await maybeCompleteQuestForObjective(service, env, sessionId, completed.id, completedIds)
  if (questCompleted) return true

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
    .select('id, index, title, description, tone, trigger_conditions, status')
    .eq('adventure_id', env.adventureId)
    .neq('status', 'discarded')
    .order('index')
  const endings = (endingRows ?? []) as { id: string; index: number; title: string; description: string; tone: string; trigger_conditions: Json; status: string }[]
  if (endings.length === 0) return

  const candidates: EndingCandidate[] = endings.map((e) => ({
    id: e.id,
    index: e.index,
    signals: parseEndingSignals(e.trigger_conditions),
  }))
  const world: EndingWorld = {
    objectiveOutcomes: Object.fromEntries(
      ordered.filter((o) => o.reveal_state === 'completed').map((o) => [o.id, 'completed' as const]),
    ),
    npcStates: await endingNpcStates(service, env.adventureId, state),
    dialValues: (adventureRow.dial_values ?? {}) as Record<string, number>,
  }
  const { scores, leadingId } = scoreEndings(candidates, world)

  const previousLeading = endings.find((e) => e.status === 'leading')?.id ?? null
  await service.from('adventures').update({ ending_scores: scores as unknown as Json }).eq('id', env.adventureId)
  if (leadingId && leadingId !== previousLeading) {
    if (previousLeading) await service.from('endings').update({ status: 'candidate' }).eq('id', previousLeading)
    await service.from('endings').update({ status: 'leading' }).eq('id', leadingId)
    await logEvent(service, env.adventureId, sessionId, 'ending_leading_changed', {
      from: previousLeading, to: leadingId, scores: scores as unknown as Json,
    })
  }

  // Commitment (F08 SS8.1): late on this ladder + decisive margin + enough recorded play.
  const ladder = {
    total: ordered.length,
    remaining: ordered.filter((o) => o.reveal_state !== 'completed').length,
  }
  if (!leadingId || !ladderReady(ladder)) return
  const { count } = await service
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId)
  if (!commitmentReady(scores, leadingId, count ?? 0, ladder)) return

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
  await service.from('adventures').update({ committed_ending_id: leadingId }).eq('id', env.adventureId)
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
  // Re-author the climax live from what actually happened (the sketch was illustrative).
  const { data: recent } = await service
    .from('event_log')
    .select('type, payload')
    .eq('adventure_id', env.adventureId)
    .order('id', { ascending: false })
    .limit(40)
  const condensed = ((recent ?? []) as { type: string; payload: Record<string, Json> }[])
    .reverse()
    .map((e) => `${e.type}: ${['text', 'title', 'tag', 'name'].map((k) => e.payload[k]).filter((v) => typeof v === 'string').join(' ')}`)
  const climax = await runClimaxAuthor(env, { title: leading.title, description: leading.description, tone: leading.tone }, condensed)
  await publishNarration(service, env, sessionId, `Narrate this climax opening, ending at a decision point: ${climax}`)
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? ''
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined

/**
 * Hand the pass's heavy tail to a FRESH worker (same pattern as guide-pipeline's `kick`).
 * WORKER_RESOURCE_LIMIT is a per-worker ceiling, not a timeout, so deferring within the same
 * worker would not help - only a new invocation gets a new budget.
 */
function kickTail(env: AgentEnv, sessionId: string): boolean {
  // Demo adventures run canned agents: no cost, no resource pressure, and the $0 suites assert
  // immediately after each intent - deferring there would only introduce a race.
  if (env.demo) return false
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) return false
  const request = fetch(`${SUPABASE_URL}/functions/v1/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'story_progress_tail', adventure_id: env.adventureId, session_id: sessionId }),
  }).catch((err) => console.error('story tail kick failed', err))
  const grace = new Promise((resolve) => setTimeout(resolve, 3000))
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(Promise.race([request, grace]))
  }
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
 */
export async function evaluateStoryProgress(service: SupabaseClient, env: AgentEnv, sessionId: string): Promise<void> {
  await commitDiffs(service, env.adventureId, () => [typingDiff(true)]).catch(() => {})
  let deferred = false
  try {
    deferred = await runStoryProgressHead(service, env, sessionId)
  } finally {
    // A deferred tail owns the typing flag from here; clearing it now would flicker the table.
    if (!deferred) await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
  }
}

/**
 * The deterministic head: objective completion + its narration. The player's turn depends on
 * this being visible immediately, and it costs at most one narration call.
 *
 * Returns true when the agent-heavy tail was handed to another worker (which then owns the
 * typing flag). Returns false when the tail ran inline - no edge runtime, or the kick failed.
 */
async function runStoryProgressHead(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
): Promise<boolean> {
  const state = (await loadState(service, env.adventureId)).state
  const events = await storyEventTags(service, env.adventureId)
  const world = worldFacts(state, events)
  const ordered = await orderedObjectives(service, env.adventureId)

  // 1. Active objective completion (F08 SS9).
  const current = ordered.find((o) => o.id === state.objectives.currentId)
  let objectiveJustCompleted = false
  let questJustCompleted = false
  if (current && current.reveal_state === 'active' && evaluatePredicate(current.completion_predicates, world)) {
    questJustCompleted = await completeObjective(service, env, sessionId, current, ordered)
    objectiveJustCompleted = true
  }

  if (kickTail(env, sessionId)) return true
  await runStoryProgressTail(service, env, sessionId, { objectiveJustCompleted, questJustCompleted })
  return false
}

interface TailContext {
  objectiveJustCompleted: boolean
  questJustCompleted: boolean
}

/**
 * The agent-heavy tail: beat re-plan (beat planner + Encounter Designer), re-weave, the dial
 * pass, and ending scoring/commitment (consistency + climax author + narration). Recomputes its
 * own world state so it is safe to run in a fresh worker, and always clears the typing flag.
 */
export async function runStoryProgressTail(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  ctx?: TailContext,
): Promise<void> {
  try {
    const state = (await loadState(service, env.adventureId)).state
    const events = await storyEventTags(service, env.adventureId)
    const world = worldFacts(state, events)
    const ordered = await orderedObjectives(service, env.adventureId)

    // A tail running in its own worker did not see the head's locals - recover them from the
    // rows the head already wrote, so a re-plan still fires on a completed objective.
    const objectiveJustCompleted = ctx?.objectiveJustCompleted ?? (await justCompletedObjective(service, env.adventureId))
    const questJustCompleted = ctx?.questJustCompleted ?? false

    // 2. Open beat exit conditions -> the next beat opens (event-driven pacing, F08 SS9.1).
    // A completed objective also forces a re-plan: the old beat's encounter spec and outcome
    // vocabulary belong to the finished objective, and leaving it open re-offers a stale
    // encounter forever (seen in the story sim, 2026-07-19). Skip the forced re-plan when the
    // objective closed a whole quest: its loop is done and completeQuest may have resumed a
    // suspended loop whose preserved beat we must not discard - only its own exit predicate reopens it.
    const loops = await loadLoops(service, env.adventureId)
    const loop = activeLoop(loops)
    if (loop?.currentBeatId) {
      const { data: beat } = await service
        .from('beats')
        .select('id, exit_conditions, status')
        .eq('id', loop.currentBeatId)
        .maybeSingle()
      const exitMet = beat?.status === 'active' && beat.exit_conditions && evaluatePredicate(beat.exit_conditions, world)
      if (exitMet || (objectiveJustCompleted && !questJustCompleted && beat?.status === 'active')) {
        await logEvent(service, env.adventureId, sessionId, 'beat_exit_met', {
          beat_id: beat!.id, ...(exitMet ? {} : { reason: 'objective_completed' }),
        })
        try {
          await planAndOpenBeat(service, env, sessionId, loop.id, exitMet ? 'beat_exit' : 'objective_completed')
        } catch (err) {
          console.error('beat re-plan failed', err)
          await logEvent(service, env.adventureId, sessionId, 'incident', {
            kind: 'beat_open_failed', trigger: exitMet ? 'beat_exit' : 'objective_completed',
          })
        }
      }
    }

    // 3. Declined offers may re-weave once enough play has passed (F08 SS6).
    await maybeReweaveDeclined(service, env, sessionId)

    // 3b. Dials move on completed objectives, not only at session end - a one-shot played in one
    // sitting otherwise never reaches its endings' dial thresholds. Runs before ending scoring so
    // the new values count this pass; never blocks progression.
    if (objectiveJustCompleted) {
      try {
        await runDialPass(service, env, sessionId, 'objective_completed')
      } catch (err) {
        console.error('dial pass failed', err)
      }
    }

    // 4. Ending scoring + (late, decisive) commitment (F08 SS8.1).
    const refreshed = (await loadState(service, env.adventureId)).state
    await updateEndings(service, env, sessionId, refreshed, await orderedObjectives(service, env.adventureId))
  } finally {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
  }
}

/** Did the most recent progress-relevant event complete an objective? (tail-worker recovery) */
async function justCompletedObjective(service: SupabaseClient, adventureId: string): Promise<boolean> {
  const { data } = await service
    .from('event_log')
    .select('type')
    .eq('adventure_id', adventureId)
    .in('type', ['objective_completed', 'beat_exit_met'])
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  return data?.type === 'objective_completed'
}
