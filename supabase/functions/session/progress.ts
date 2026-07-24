// F08 SS9 + SS8.1: the deterministic story-progress pass. Evaluates the active objective's
// completion predicate and the open beat's exit conditions against the world fact base,
// advances the reveal order, re-scores candidate endings on every pass (an Engine, not an
// LLM), and drafts the commitment when one ending pulls decisively clear near the climax.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { GameState, Json, StateDiff } from '../_shared/state/index.ts'
import {
  activeLoop, commitmentReady, evaluatePredicate, ladderReady, listMilestoneAtoms,
  parseEndingSignals, scoreEndings,
} from '../_shared/story/index.ts'
import type { EndingCandidate, EndingWorld, WorldFacts } from '../_shared/story/index.ts'
import { runClaimCheck, runConsistency, runObjectiveJudge } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { loadLoops, planAndOpenBeat } from './beats.ts'
import { recordSceneLedger } from './ledger.ts'
import { applyMilestones } from './milestones.ts'
import { narrationBeat } from './narration.ts'
import { appendLinesDiff, newLine, typingDiff } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { beatRouteHealth } from './route-health.ts'
import { antagonistTurn } from './steward.ts'
import { maybeCompleteQuestForObjective, maybeReweaveDeclined } from './story.ts'
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
}

export async function orderedObjectives(service: SupabaseClient, adventureId: string): Promise<ObjectiveRow[]> {
  const [{ data: chapters }, { data: objectives }] = await Promise.all([
    service.from('chapters').select('id, index').eq('adventure_id', adventureId).order('index'),
    service.from('objectives').select('id, chapter_id, index, title, reveal_state, outcome, guaranteed_route, completion_predicates, hidden_description').eq('adventure_id', adventureId),
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
  await recordSceneLedger(service, env, sessionId, 'objective', completed.title)
  await service.from('objectives').update({ reveal_state: 'completed' }).eq('id', completed.id)
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
    await service.from('objectives').update({ reveal_state: 'completed' }).eq('id', next.id)
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

  // If this closed the last open objective of an accepted quest's contract, close the quest
  // (loop complete + one-time payout).
  // SUCCEEDED objectives only. `reveal_state: 'completed'` means TERMINAL since fail-forward
  // landed (failObjective sets it alongside outcome:'failed'), so filtering on it alone would
  // hand a quest its payout for objectives the party never managed - paying gold for failure.
  const completedIds = new Set(
    ordered.filter((o) => o.reveal_state === 'completed' && o.outcome !== 'failed').map((o) => o.id),
  )
  const questCompleted = await maybeCompleteQuestForObjective(service, env, sessionId, completed.id, completedIds)

  // Surface the next thread in the fiction. completeQuest already narrated the reward + "what comes
  // next" beat, so on the quest path we do NOT recap the accomplishment again - but the new objective
  // still owes the player a reason it exists. Skipping that hook entirely is exactly how the climax
  // objective surfaced with no bridge (live 2026-07-22); a short forward-only beat is far better than
  // a silent reveal. When nothing new surfaced (next is null), the quest/final-objective resolution
  // narration stands alone.
  if (questCompleted) {
    if (next) {
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
 * Fail-forward (overhaul Phase 4): retire an objective the party could not finish and move the
 * story on. Mirrors completeObjective's ladder mechanics, but the outcome is 'failed' - the
 * ending signal vocabulary has always accepted {objective_id, outcome:'failed'} and nothing
 * ever produced one, so a story that stalled here simply never ended.
 *
 * This is the LAST rung and a genuine last resort (default: 15 no-progress turns, full-AI
 * only - assist gets a DM proposal instead). The narration frames it as the antagonist gaining
 * ground, never as the party being told they lost.
 */
export async function failObjective(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  reason: string,
): Promise<boolean> {
  const ordered = await orderedObjectives(service, env.adventureId)
  const state = (await loadState(service, env.adventureId)).state
  const current = ordered.find((o) => o.id === state.objectives.currentId)
  if (!current || current.reveal_state !== 'active') return false

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

  await service.from('objectives').update({ reveal_state: 'completed', outcome: 'failed' }).eq('id', current.id)
  await logEvent(service, env.adventureId, sessionId, 'objective_failed', {
    objective_id: current.id, title: current.title, reason,
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
    return [
      appendLinesDiff(s, [newLine(null, null, `The moment passes: ${current.title}`)]),
      { domain: 'objectives', patch: { currentId: next?.id ?? null, list: list as unknown as Json } },
    ] as StateDiff[]
  })
  // The world took the win. An antagonist step makes the failure a real event rather than a
  // silent bookkeeping change.
  try {
    await antagonistTurn(service, env, sessionId, 'objective_failed')
  } catch (err) {
    console.error('fail-forward antagonist turn failed', err)
  }
  await narrationBeat(
    service, env, sessionId,
    `The party never managed "${current.title}", and the chance has now passed them by. Narrate ` +
      'what that COSTS - what the opposition gains, what closes off, who is worse for it - as ' +
      'something that happens in the world, never as a verdict on the players.' +
      (next
        ? ` Then let the next thread surface in the fiction: "${next.title}". Do not state it as a task.`
        : ' End on what is now at stake.') +
      ' End at a concrete decision point.',
    'The moment passes',
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
  // Phase 4: every objective is terminal, so there is nothing left to play toward - the story
  // MUST end here even if no ending pulled decisively clear (a run that fail-forwarded its way
  // down the ladder can finish with a muddy score and would otherwise just stop).
  const allTerminal = ladder.total > 0 && ladder.remaining === 0
  if (!leadingId || (!ladderReady(ladder) && !allTerminal)) return
  const { count } = await service
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId)
  if (!allTerminal && !commitmentReady(scores, leadingId, count ?? 0, ladder)) return
  if (allTerminal) {
    await logEvent(service, env.adventureId, sessionId, 'ending_forced', {
      reason: 'all objectives terminal', scores: scores as unknown as Json,
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
  let climax = (await runClimaxAuthor(
    env, { title: leading.title, description: leading.description, tone: leading.tone }, condensed,
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
  if (violations.length > 0) {
    await logEvent(service, env.adventureId, sessionId, 'ending_climax_reauthored', {
      ending_id: leadingId, violations: violations.map((v) => `${v.name} (${v.state})`),
    }).catch(() => {})
    climax = leading.climax_summary || leading.description
  }
  const endingText = `${leading.title}\n\n${climax}`
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(null, null, endingText)]), typingDiff(false),
  ])
  await logEvent(service, env.adventureId, sessionId, 'narration_published', {
    text: endingText, source: 'ending_climax',
  })

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
  opts?: { forceRecognition?: boolean },
): Promise<void> {
  await commitDiffs(service, env.adventureId, () => [typingDiff(true)]).catch(() => {})
  try {
    await runStoryProgressHead(service, env, sessionId, opts?.forceRecognition ?? false)
  } finally {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
  }
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
  forceRecognition: boolean,
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
    if (!evaluatePredicate(current.completion_predicates, world)) break
    questJustCompleted = (await completeObjective(service, env, sessionId, current, ordered, world)) || questJustCompleted
    objectiveJustCompleted = true
  }

  if (kickTail(env, sessionId)) return
  await runStoryProgressTail(service, env, sessionId, {
    objectiveJustCompleted, questJustCompleted, forceRecognition,
  })
}

interface TailContext {
  objectiveJustCompleted: boolean
  questJustCompleted: boolean
  /** Ask the recognition judge even though no beat ended - see the judge's own comment. */
  forceRecognition?: boolean
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
        .select('id, exit_conditions, status, encounter_spec')
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
      if (exitMet || beatSpent || (objectiveJustCompleted && !questJustCompleted && beat?.status === 'active')) {
        await logEvent(service, env.adventureId, sessionId, 'beat_exit_met', {
          beat_id: beat!.id, ...(exitMet ? {} : { reason: trigger }),
        })
        try {
          await planAndOpenBeat(service, env, sessionId, loop.id, exitMet ? 'beat_exit' : 'objective_completed')
        } catch (err) {
          console.error('beat re-plan failed', err)
          await logEvent(service, env.adventureId, sessionId, 'incident', {
            kind: 'beat_open_failed', trigger,
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
      if ((exitMet || beatSpent || ctx?.forceRecognition) && !objectiveJustCompleted) {
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
