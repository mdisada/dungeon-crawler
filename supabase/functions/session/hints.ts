// Stuck-hint ladder (2026-07-20): players actively trying but not progressing get an
// escalating, in-fiction nudge from the DM. Two entry points share one ladder: a player-
// requested "get your bearings" and a conservative full-AI auto-sweep (client-driven like the
// idle nudge, so hint narration never rides the main intent's worker). The pure decision
// (_shared/play/hints.ts) picks the rung; this module counts no-progress turns from the event
// log and delivers the rung's content, drawing on real world content (beat goals, undiscovered
// ingredients, the Hook Weaver, authored puzzle hints, the encounter's fail-forward).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { decideHint, DEFAULT_HINT_TURNS, dmSettings } from '../_shared/play/index.ts'
import type { HintRung } from '../_shared/play/index.ts'
import { activeLoop } from '../_shared/story/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { loadLoops } from './beats.ts'
import { activeEncounter, openSkillChallengeFromSpec, resolveOpenEncounter } from './encounters.ts'
import { openBeatSpec } from './entry.ts'
import { startSocial } from './social-staging.ts'
import { narrationBeat } from './narration.ts'
import { loadPlayContext, typingDiff } from './orchestrate.ts'
import { puzzleSpec } from './puzzle-encounter.ts'
import { antagonistTurn } from './steward.ts'
import { runHookWeaverLive, runStallPromoter } from './story-agents.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

/**
 * No-progress turns before a table with nothing to engage gets an opening put in front of it.
 * Lower than the hint ladder's thresholds on purpose - there is nothing here to hint AT.
 */
const DEAD_TABLE_TURNS = 3

interface EventRow {
  id: number
  type: string
  payload: Record<string, Json>
}

/**
 * Progress = the spine actually moved. Resets the stuck streak. Kept broad so a party that is
 * genuinely advancing (landing challenge attempts, entering encounters, hitting milestones) is
 * never nudged.
 */
function isProgress(e: EventRow): boolean {
  switch (e.type) {
    case 'milestone_reached':
    case 'beat_exit_met':
    case 'objective_completed':
    case 'objective_revealed':
    case 'encounter_resolved':
    case 'encounter_opened':
    case 'scene_travel':
    case 'offer_accepted':
      return true
    case 'encounter_attempt':
      return e.payload.success === true || e.payload.result === 'solves' || e.payload.result === 'advances_step'
    case 'entry_mapped':
      return e.payload.entry === 'offered' || e.payload.entry === 'adhoc'
    default:
      return false
  }
}

/** Player turns + hints delivered since the last progress event (the ladder window). */
async function stuckWindow(
  service: SupabaseClient,
  adventureId: string,
): Promise<{ noProgressTurns: number; hintsSinceProgress: number }> {
  const { data, error } = await service
    .from('event_log')
    .select('id, type, payload')
    .eq('adventure_id', adventureId)
    .order('id', { ascending: false })
    .limit(60)
  assertOk(error, 'event log load failed')
  const rows = (data ?? []) as EventRow[]
  let noProgressTurns = 0
  let hintsSinceProgress = 0
  for (const e of rows) {
    if (isProgress(e)) break
    if (e.type === 'hint_given') hintsSinceProgress += 1
    else if (e.type === 'intent_submitted' && e.payload.kind !== 'dm_command') noProgressTurns += 1
  }
  return { noProgressTurns, hintsSinceProgress }
}

async function undiscoveredReveal(service: SupabaseClient, adventureId: string): Promise<string | null> {
  const { data } = await service
    .from('ingredients')
    .select('reveals')
    .eq('adventure_id', adventureId)
    .eq('discovered', false)
    .not('reveals', 'is', null)
    .limit(1)
  const reveals = ((data ?? []) as { reveals: string | null }[])[0]?.reveals
  return reveals && reveals.trim() ? reveals.trim() : null
}

/** Where the party stands, for grounding the hint prompts. */
function situation(state: GameState): string {
  const enc = state.encounter
  const objective = state.objectives.list.find((o) => o.id === state.objectives.currentId)?.title
  return [
    `Scene: ${state.scene.locationName || 'unknown'} (${state.scene.mode}).`,
    objective ? `Current goal: ${objective}.` : '',
    enc ? `They are mid-${enc.kind.replaceAll('_', ' ')} "${enc.label}"${enc.stakes ? ` - at stake: ${enc.stakes}` : ''}.` : '',
  ].filter(Boolean).join(' ')
}

/**
 * Server-driven stall sweep, run after a turn resolves. The ladder used to engage only when a
 * CLIENT swept for it, so a table whose client never polls (or a headless run) could grind
 * indefinitely - the multi-chapter playtest took 26 turns with zero nudges (2026-07-21).
 *
 * decideHint is the guard: it returns null unless the no-progress streak has earned the next
 * rung, so calling this every turn is cheap and cannot repeat a rung.
 */
export async function maybeAutoHint(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
): Promise<void> {
  if (env.mode !== 'full_ai') return // assist: the human DM drives pacing
  // Demo adventures are scripted fixtures: an unsolicited nudge only corrupts their assertions,
  // the same reason the ledger is canned and the progress tail is not deferred there.
  if (env.demo) return
  const state = (await loadState(service, env.adventureId)).state
  if (!['narration', 'roleplay', 'downtime', 'puzzle'].includes(state.scene.mode)) return
  if (state.dialogue.pending || state.dialogue.typing || state.dm?.pendingReview) return

  const { noProgressTurns, hintsSinceProgress } = await stuckWindow(service, env.adventureId)

  // A DEAD TABLE is a different condition from a stuck one, and deserves a different answer.
  // Stuck-on-a-challenge earns the gentle ladder: re-frame, orient, steer. But a cutscene with
  // no encounter open and nobody staged offers the party NOTHING to act on - every input can
  // only fold into narration. Waiting out the full ladder there burned five turns before
  // anything opened, twice, in live one-shots (2026-07-21). Promote immediately instead.
  const deadTable = !state.encounter && state.dialogue.speakers.length === 0
  if (deadTable && noProgressTurns >= DEAD_TABLE_TURNS) {
    if (await promoteStall(service, env, sessionId, state)) {
      await logEvent(service, env.adventureId, sessionId, 'hint_given', {
        rung: 0, source: 'dead_table', no_progress_turns: noProgressTurns,
      })
      return
    }
  }

  const { rung } = decideHint({
    noProgressTurns,
    hintsSinceProgress,
    requested: false,
    turnsThreshold: dmSettings(state).hintTurns ?? DEFAULT_HINT_TURNS,
    allowFailForward: true,
  })
  if (rung === null) return
  await deliverHint(service, env, sessionId, state, rung, false)
  await logEvent(service, env.adventureId, sessionId, 'hint_given', {
    rung, source: 'auto_turn', no_progress_turns: noProgressTurns,
  })
}

/**
 * The shared ladder entry. `requested` = the player asked; otherwise the client auto-sweep.
 * Guards mirror the idle nudge (narrative mode, table not busy). Returns 409 when there is
 * nothing to hint (not stuck / already at this rung) - the normal case for the auto sweep.
 */
export async function hintAction(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  requested: boolean,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value
  const state = row.state

  if (!['narration', 'roleplay', 'downtime', 'puzzle'].includes(state.scene.mode)) {
    return { status: 409, body: { error: 'No hints in this scene mode' } }
  }
  if (state.dialogue.pending || state.dialogue.typing || state.dm?.pendingReview) {
    return { status: 409, body: { error: 'The table is busy' } }
  }
  const env: AgentEnv = {
    service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode,
  }
  // The auto detector is full-AI only; in assist the human DM drives, and player-requested
  // hints still route through the narration review gate (narrationBeat).
  if (!requested && env.mode !== 'full_ai') {
    return { status: 409, body: { error: 'Auto hints are full-AI only' } }
  }

  const { noProgressTurns, hintsSinceProgress } = await stuckWindow(service, adventureId)
  const { rung } = decideHint({
    noProgressTurns,
    hintsSinceProgress,
    requested,
    turnsThreshold: dmSettings(state).hintTurns ?? DEFAULT_HINT_TURNS,
    allowFailForward: env.mode === 'full_ai',
  })
  if (rung === null) {
    return { status: 409, body: { error: requested ? 'Nothing to add just yet' : 'Not stuck' } }
  }

  await deliverHint(service, env, play.sessionId, state, rung, requested)
  await logEvent(service, adventureId, play.sessionId, 'hint_given', {
    rung, source: requested ? 'requested' : 'auto', no_progress_turns: noProgressTurns,
  })
  return { status: 200, body: { ok: true, resolved: 'hint', rung } }
}

/**
 * Opens the thing the stalled party is reaching for. Returns true when something was staged or
 * opened, so the caller stops - the new encounter IS the nudge.
 */
async function promoteStall(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
): Promise<boolean> {
  const [{ data: npcRows }, { data: inputRows }] = await Promise.all([
    service.from('npcs').select('id, name, generated, initial_state').eq('adventure_id', env.adventureId),
    service
      .from('event_log')
      .select('payload')
      .eq('adventure_id', env.adventureId)
      .eq('type', 'intent_submitted')
      .order('id', { ascending: false })
      .limit(8),
  ])
  // Only NPCs who can actually be staged: alive, present, authored.
  const staged = new Set(state.dialogue.speakers.map((sp) => sp.npcId))
  const liveStates = state.dm?.facts.npcStates ?? {}
  const candidates = ((npcRows ?? []) as { id: string; name: string; generated: boolean; initial_state?: string }[])
    .filter((n) => !n.generated && n.name && !staged.has(n.id))
    .filter((n) => {
      const st = liveStates[n.id] ?? n.initial_state ?? 'alive'
      return st !== 'dead' && st !== 'absent'
    })
  const recentInputs = ((inputRows ?? []) as { payload: Record<string, Json> }[])
    .map((e) => String(e.payload.text ?? ''))
    .filter(Boolean)
    .reverse()
  if (recentInputs.length === 0) return false

  const loop = activeLoop(await loadLoops(service, env.adventureId))
  const { spec } = await openBeatSpec(service, env.adventureId)
  const opening = await runStallPromoter(env, {
    recentInputs,
    sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode}), day ${state.scene.day}`,
    hook: spec ? `${spec.label}${spec.stakes ? ` - at stake: ${spec.stakes}` : ''}` : null,
    npcNames: candidates.map((n) => n.name),
    loopType: loop?.type ?? 'custom',
  })
  if (opening.action === 'none') return false

  if (opening.action === 'stage_npc') {
    const ids = opening.npcNames
      .map((name) => candidates.find((n) => n.name.toLowerCase() === name.toLowerCase())?.id)
      .filter((id): id is string => Boolean(id))
    if (ids.length === 0) return false
    const result = await startSocial(service, env.adventureId, env.creatorId, ids)
    if (result.status !== 200) return false
    await logEvent(service, env.adventureId, sessionId, 'stall_promoted', {
      action: 'stage_npc', npcs: opening.npcNames as unknown as Json, why: opening.why,
    })
    await narrationBeat(
      service, env, sessionId,
      `The party has been circling with nobody to turn to. ${opening.npcNames.join(' and ')} ` +
        `arrives or is found - ${opening.why || 'exactly who they have been asking about'}. ` +
        'Bring them into the scene in one or two sentences and let them speak first, leaving the ' +
        'next move to the party.',
      'Someone arrives',
    )
    return true
  }

  const encounter = await openSkillChallengeFromSpec(service, env, sessionId, {
    kind: 'skill_challenge',
    label: opening.label || 'The way forward',
    stakes: opening.why,
    params: {},
    // No outcome map: a promoted opening must not hand out progression it did not author.
    onSuccess: [],
    onPartial: [],
    onFailure: [],
  })
  await logEvent(service, env.adventureId, sessionId, 'stall_promoted', {
    action: 'open_encounter', label: encounter.label, why: opening.why,
  })
  await narrationBeat(
    service, env, sessionId,
    `The party has been circling. Make "${encounter.label}" concrete and immediate in front of ` +
      `them - ${opening.why || 'the thing they have been reaching for'} - and end demanding ` +
      'their first move against it.',
    'A way forward opens',
  )
  return true
}

async function deliverHint(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
  rung: HintRung,
  requested: boolean,
): Promise<void> {
  const ground = situation(state)
  const opener = requested
    ? 'The party pauses to take stock - the DM answers their unspoken "what now?" in the fiction.'
    : 'The party has been circling without progress - the DM leans in with a light, in-fiction nudge.'
  const encounter = activeEncounter(state)

  if (rung === 1) {
    // Re-frame: re-see the obstacle and its stakes vividly, NO new information.
    await narrationBeat(
      service, env, sessionId,
      `${opener} ${ground} Re-frame the situation they are stuck on: make the obstacle and what ` +
        'hangs on it vivid and concrete again, WITHOUT revealing anything new or naming a ' +
        'skill/mechanic. End by putting the decision back in their hands.',
      'Hint: re-frame',
    )
    return
  }

  if (rung === 2) {
    // Orient: surface an existing, undiscovered clue as an in-fiction detail.
    const reveal = await undiscoveredReveal(service, env.adventureId)
    let seed = reveal
    if (!seed) {
      const objective = state.objectives.list.find((o) => o.id === state.objectives.currentId)?.title
      const loop = activeLoop(await loadLoops(service, env.adventureId))
      const { data: beat } = loop?.currentBeatId
        ? await service.from('beats').select('name').eq('id', loop.currentBeatId).maybeSingle()
        : { data: null }
      const hooks = objective
        ? await runHookWeaverLive(
            env, { title: objective, hiddenDescription: '' },
            (beat?.name as string) ?? 'the current situation', ground,
          )
        : []
      seed = hooks[0]?.textSeed ?? null
    }
    await narrationBeat(
      service, env, sessionId,
      `${opener} ${ground} Draw their attention to something already here that points a way ` +
        `forward - a detail they can act on, a companion's passing thought, a half-remembered ` +
        `fact.${seed ? ` Work this in as that detail: "${seed}".` : ''} Deliver it in the fiction, ` +
        'never as instructions, and leave the next move to them.',
      'Hint: orient',
    )
    return
  }

  if (rung === 3) {
    // Steer: the most direct in-fiction nudge short of doing it for them.
    if (encounter?.kind === 'puzzle') {
      const spec = puzzleSpec((state.dm?.encounterSpec?.params ?? {}) as Record<string, Json>)
      const p = (typeof encounter.progress === 'object' && encounter.progress !== null && !Array.isArray(encounter.progress)
        ? encounter.progress
        : {}) as Record<string, Json>
      const stepsDone = typeof p.stepsDone === 'number' ? p.stepsDone : 0
      const hint = spec.steps[Math.min(stepsDone, spec.steps.length - 1)]?.hint
      await narrationBeat(
        service, env, sessionId,
        `${opener} ${ground} Give them the puzzle's next real clue as an in-fiction detail they ` +
          `notice${hint ? `: "${hint}"` : ''}. Point clearly toward the next step WITHOUT solving ` +
          'it for them or naming mechanics.',
        'Hint: steer',
      )
      return
    }
    if (encounter?.kind === 'skill_challenge') {
      const p = (typeof encounter.progress === 'object' && encounter.progress !== null && !Array.isArray(encounter.progress)
        ? encounter.progress
        : {}) as Record<string, Json>
      const skills = Array.isArray(p.suggestedSkills)
        ? (p.suggestedSkills as Json[]).filter((s): s is string => typeof s === 'string')
        : []
      await narrationBeat(
        service, env, sessionId,
        `${opener} ${ground} Their current approach isn't working. Steer them in the fiction ` +
          `toward a promising angle${skills.length > 0 ? ` (in spirit: ${skills.join(', ')})` : ''} - ` +
          'describe what such an approach would look like here, as an idea a companion voices or ' +
          'the scene invites. Never name a skill or a DC.',
        'Hint: steer',
      )
      return
    }
    // Cutscene: a companion / the narration proposes a concrete next action toward the goal.
    await narrationBeat(
      service, env, sessionId,
      `${opener} ${ground} Have a present companion or the moment itself propose a concrete next ` +
        'move toward the goal - a specific direction, person, or action - as an in-fiction ' +
        'suggestion the party can take or refuse. Do not resolve it for them.',
      'Hint: steer',
    )
    return
  }

  // Rung 4 - fail-forward: never let the table hard-lock. Full-AI only (gated upstream).
  if (encounter) {
    // The encounter's authored on_failure fires; the story moves on at a cost.
    await commitDiffs(service, env.adventureId, () => [typingDiff(true)]).catch(() => {})
    await resolveOpenEncounter(
      service, env, sessionId, 'failed',
      'The party could not crack it and time ran out - resolve the encounter as a fail-forward: ' +
        'the story moves on, worse, but it MOVES. Show the cost and open the way ahead.',
    )
    return
  }
  // Cutscene with no encounter: there is nothing to fail forward THROUGH, which is exactly how
  // ten turns of "who did it" folded into narration while the story stood still (live
  // 2026-07-21). Put something in front of them first - the promoter opens what they have been
  // reaching for. It writes no progression; the normal encounter machinery takes it from there.
  if (await promoteStall(service, env, sessionId, state)) return

  try {
    await antagonistTurn(service, env, sessionId, 'hint_fail_forward')
  } catch (err) {
    console.error('hint fail-forward antagonist turn failed', err)
  }
  await narrationBeat(
    service, env, sessionId,
    `${opener} ${ground} The party is well and truly stuck, so the world moves for them: let ONE ` +
      'concrete development open a clear way forward - an arrival, a change in the scene, a path ' +
      'revealed - that hands them an obvious next thing to engage. End at that new opening.',
    'Hint: opening',
  )
}
