// F08 beat pacing: variety counting inputs, the Beat Planner open-beat flow (pool reuse before
// generation), the deterministic off-loop streak -> Loop Classifier trigger, and the idle
// nudge. Never imports story.ts (offer glue) - callers compose the two.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { dmSettings } from '../_shared/play/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'
import {
  activeLoop, advanceBeat, completeLoop, computeVarietyFlags, intentPillar, isOffLoop,
  listMilestoneAtoms, LOOP_TEMPLATES, nextStreak, PIVOT_REEVALUATE_EVENTS, pivotHandling,
  pushLoop, streakTriggersClassifier, suspendLoop, varietyGuidance,
} from '../_shared/story/index.ts'
import type { BeatPlan, CoreLoop, LoopStatus, LoopType, Pillar, VarietyInput } from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { narrationBeat } from './narration.ts'
import { loadPartyCharacters, loadPlayContext, partyProfileLines, partySkillList } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { antagonistTurn } from './steward.ts'
import { retrieveMemories } from './memory.ts'
import { runBeatPlanner, runEncounterDesigner, runHookWeaverLive, runLoopClassifier } from './story-agents.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

export async function loadLoops(service: SupabaseClient, adventureId: string): Promise<CoreLoop[]> {
  const { data, error } = await service
    .from('core_loops')
    .select('id, type, status, stack_position, current_beat_id, custom_label')
    .eq('adventure_id', adventureId)
  assertOk(error, 'core loops load failed')
  return (data ?? []).map((l) => ({
    id: l.id as string,
    type: l.type as LoopType,
    status: l.status as LoopStatus,
    stackPosition: Number(l.stack_position),
    currentBeatId: (l.current_beat_id as string) ?? null,
    customLabel: (l.custom_label as string) ?? null,
  }))
}

export async function persistLoops(service: SupabaseClient, adventureId: string, before: CoreLoop[], after: CoreLoop[]): Promise<void> {
  const prior = new Map(before.map((l) => [l.id, l]))
  for (const loop of after) {
    const was = prior.get(loop.id)
    if (!was) {
      const { error } = await service.from('core_loops').insert({
        id: loop.id, adventure_id: adventureId, type: loop.type, status: loop.status,
        stack_position: loop.stackPosition, current_beat_id: loop.currentBeatId, custom_label: loop.customLabel,
      })
      assertOk(error, 'core loop insert failed')
    } else if (was.status !== loop.status || was.currentBeatId !== loop.currentBeatId) {
      const { error } = await service
        .from('core_loops')
        .update({ status: loop.status, current_beat_id: loop.currentBeatId })
        .eq('id', loop.id)
      assertOk(error, 'core loop update failed')
    }
  }
}

interface EventRow {
  type: string
  session_id: string | null
  payload: Record<string, Json>
}

async function recentEventRows(service: SupabaseClient, adventureId: string, limit: number): Promise<EventRow[]> {
  const { data, error } = await service
    .from('event_log')
    .select('type, session_id, payload')
    .eq('adventure_id', adventureId)
    .order('id', { ascending: false })
    .limit(limit)
  assertOk(error, 'event log load failed')
  return ((data ?? []) as EventRow[]).reverse()
}

const COOP_EVENT_TYPES = new Set(['assist_claimed', 'group_check_resolved', 'opening_consumed'])

/** Pure-counting inputs for the Variety Manager (F08 SS7), derived from the event log. */
export async function varietyInput(service: SupabaseClient, adventureId: string, sessionId: string): Promise<VarietyInput> {
  const [loops, events, sessions] = await Promise.all([
    loadLoops(service, adventureId),
    recentEventRows(service, adventureId, 600),
    service.from('sessions').select('id').eq('adventure_id', adventureId).order('index', { ascending: false }).limit(2),
  ])
  const recentSessionIds = new Set(((sessions.data ?? []) as { id: string }[]).map((s) => s.id))

  const pillarUsage: VarietyInput['pillarUsage'] = {}
  const resolvedIntents: Record<string, number> = {}
  let coopEventsThisSession = 0
  for (const event of events) {
    if (event.type === 'intent_submitted') {
      const player = String(event.payload.character_id ?? '')
      if (!player) continue
      const pillar = intentPillar(String(event.payload.kind ?? 'do'))
      const usage = (pillarUsage[player] ??= {
        total: { combat: 0, social: 0, exploration: 0 },
        recentSessions: { combat: 0, social: 0, exploration: 0 },
      })
      usage.total[pillar as Pillar] += 1
      if (event.session_id && recentSessionIds.has(event.session_id)) usage.recentSessions[pillar as Pillar] += 1
    }
    if (event.session_id === sessionId) {
      if (COOP_EVENT_TYPES.has(event.type)) coopEventsThisSession += 1
      if (event.type === 'check_rolled') {
        const player = String(event.payload.character_id ?? '')
        if (player) resolvedIntents[player] = (resolvedIntents[player] ?? 0) + 1
      }
    }
  }

  const beatOpens = events.filter((e) => e.type === 'beat_opened')
  let coopDemandStreak = 0
  for (let i = beatOpens.length - 1; i >= 0; i--) {
    if (beatOpens[i].payload.coop_demand === true) coopDemandStreak += 1
    else break
  }

  return {
    completedLoopTypes: loops.filter((l) => l.status === 'completed').map((l) => l.type),
    pillarUsage,
    coopEventsThisSession,
    coopDemandStreak,
    resolvedIntents,
  }
}

async function activeObjectiveRow(service: SupabaseClient, state: GameState) {
  if (!state.objectives.currentId) return null
  const { data } = await service
    .from('objectives')
    .select('id, title, hidden_description, completion_predicates')
    .eq('id', state.objectives.currentId)
    .maybeSingle()
  return data as { id: string; title: string; hidden_description: string; completion_predicates: Json } | null
}

/**
 * Plan and open the next beat of a loop (F08 SS4): variety flags feed the planner, pool
 * ingredients are reused before anything new is generated, the previous beat closes, and the
 * Narrator opens the new one from its seed - ending at a decision point.
 */
export async function planAndOpenBeat(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  loopId: string,
  trigger: string,
  narrationContext?: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const loops = await loadLoops(service, env.adventureId)
  const loop = loops.find((l) => l.id === loopId)
  if (!loop || loop.status !== 'active') return { status: 409, body: { error: 'No active loop with that id' } }

  const state = (await loadState(service, env.adventureId)).state
  const [beatRows, objective, party, pool, variety] = await Promise.all([
    service.from('beats').select('id, name, status').eq('core_loop_id', loop.id).order('index'),
    activeObjectiveRow(service, state),
    loadPartyCharacters(service, env.adventureId),
    service.from('ingredients').select('id, type, reveals').eq('adventure_id', env.adventureId).eq('discovered', false).limit(6),
    varietyInput(service, env.adventureId, sessionId),
  ])
  // The currently-open beat closes below - it belongs to the history the planner plans past.
  const completedBeatNames = ((beatRows.data ?? []) as { name: string; status: string }[])
    .filter((b) => b.status === 'completed' || b.status === 'active')
    .map((b) => b.name)
  const flags = computeVarietyFlags(variety)
  const guidance = varietyGuidance(flags)

  const profileLines = await partyProfileLines(service, party)
  // Outcome-map vocabulary: the active objective's authored atoms (the planner also maps
  // onto its own exit_conditions - the parser validates against both).
  const objectiveAtoms = listMilestoneAtoms(objective?.completion_predicates ?? null)
  // Retrieval memory (Slice 7): the planner plans past what earlier sessions established.
  const establishedEarlier = await retrieveMemories(
    service, env,
    `${objective?.title ?? loop.type} - ${state.scene.locationName || 'the current scene'}`,
  )
  const plannerCtx = {
    loop: { type: loop.type, completedBeatNames },
    objective: objective ? { title: objective.title, hiddenDescription: objective.hidden_description } : null,
    sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode}), day ${state.scene.day}`,
    // Full profile lines (2026-07-20): beats and encounters plan around who these PCs are.
    partySummary: profileLines.join('\n') ||
      party.map((c) => `${c.name} (${c.class_key ?? 'adventurer'} ${c.level})`).join(', '),
    poolIngredients: ((pool.data ?? []) as { id: string; type: string; reveals: string }[]),
    varietyGuidance: guidance,
    establishedEarlier,
    plan: {
      partySize: party.length,
      partySkills: partySkillList(party),
      milestones: [...objectiveAtoms.flags, ...objectiveAtoms.events, ...objectiveAtoms.facts],
    },
  }
  let parsed = await runBeatPlanner(env, plannerCtx)
  // One GUIDED repair, not a blind re-roll: the first repair step captures the bulk of the
  // achievable gain, and re-rolling the same prompt is what produced the invented milestone
  // that stalled the loop (live 2026-07-21).
  if (!parsed.ok) parsed = await runBeatPlanner(env, plannerCtx, parsed.errors)
  const plan: BeatPlan = parsed.ok
    ? parsed.plan
    : {
        name: LOOP_TEMPLATES[loop.type].beats[Math.min(completedBeatNames.length, LOOP_TEMPLATES[loop.type].beats.length - 1)],
        goals: ['The party must decide its next move.'],
        exitConditions: null,
        ingredientRequests: [],
        braided: [],
        narrationSeed: 'The moment stretches - the next move belongs to the party.',
        // Null spec: this beat degrades to hook -> ad-hoc entries only.
        encounter: null,
      }
  if (!parsed.ok) {
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'beat_planner_failure', errors: parsed.errors as unknown as Json,
    })
  }

  // The Encounter Designer fills kind-specific mechanics; stored snake_case on the beat row.
  let encounterSpec: Json = null
  if (plan.encounter) {
    const npcNames = plan.encounter.kind === 'social'
      ? (((await service.from('npcs').select('name').eq('adventure_id', env.adventureId)).data ?? []) as { name: string }[])
          .map((n) => n.name)
      : []
    const params = await runEncounterDesigner(env, plan.encounter, {
      size: party.length,
      skills: partySkillList(party),
      profiles: profileLines,
    }, npcNames)
    encounterSpec = {
      kind: plan.encounter.kind,
      label: plan.encounter.label,
      stakes: plan.encounter.stakes,
      rationale: plan.encounter.rationale,
      params,
      on_success: plan.encounter.onSuccess,
      on_partial: plan.encounter.onPartial,
      on_failure: plan.encounter.onFailure,
    }
  }

  // Close the open beat, insert the new one, advance the loop pointer.
  const { error: closeError } = await service
    .from('beats')
    .update({ status: 'completed' })
    .eq('core_loop_id', loop.id)
    .eq('status', 'active')
  assertOk(closeError, 'beat close failed')
  const { data: beatRow, error: beatError } = await service
    .from('beats')
    .insert({
      core_loop_id: loop.id,
      index: (beatRows.data ?? []).length,
      name: plan.name,
      goals: plan.goals as unknown as Json,
      exit_conditions: plan.exitConditions,
      ingredient_requests: plan.ingredientRequests as unknown as Json,
      encounter_spec: encounterSpec,
      status: 'active',
    })
    .select('id')
    .single()
  assertOk(beatError, 'beat insert failed')
  const advanced = advanceBeat(loops, loop.id, beatRow.id as string)
  if (advanced.ok) await persistLoops(service, env.adventureId, loops, advanced.loops)

  // Pool reuse before generation (F08 SS5): a pooled undiscovered ingredient of the requested
  // type serves the request; only unmet requests create new rows (logged as generated).
  const poolByType = new Map<string, { id: string; type: string; reveals: string }[]>()
  for (const p of plannerCtx.poolIngredients) {
    poolByType.set(p.type, [...(poolByType.get(p.type) ?? []), p])
  }
  for (const request of plan.ingredientRequests) {
    const available = poolByType.get(request.type) ?? []
    const reused = available.shift()
    if (reused) {
      poolByType.set(request.type, available)
      await logEvent(service, env.adventureId, sessionId, 'beat_ingredient_reused', {
        beat_id: beatRow.id, ingredient_id: reused.id, type: request.type,
      })
      continue
    }
    const { data: created, error: ingredientError } = await service
      .from('ingredients')
      .insert({
        adventure_id: env.adventureId,
        type: request.type,
        content: { text: request.purpose } as unknown as Json,
        reveals: request.purpose,
        pillar_tags: request.pillarTags,
        placement: {} as unknown as Json,
        canon_source: 'generated',
      })
      .select('id')
      .single()
    assertOk(ingredientError, 'ingredient generate failed')
    await logEvent(service, env.adventureId, sessionId, 'ingredient_generated', {
      beat_id: beatRow.id, ingredient_id: created.id, type: request.type, purpose: request.purpose,
    })
  }

  await logEvent(service, env.adventureId, sessionId, 'beat_opened', {
    core_loop_id: loop.id, beat_id: beatRow.id, name: plan.name, trigger,
    braided: plan.braided.length as unknown as Json, coop_demand: plan.braided.length > 0,
    variety_flags: flags as unknown as Json,
    encounter_kind: plan.encounter?.kind ?? null,
  })

  // Live Hook Weaver pass (F08 SS6): refresh this objective's live hooks, delivered as agent
  // context - never broadcast directly.
  if (objective) {
    const hooks = await runHookWeaverLive(env, { title: objective.title, hiddenDescription: objective.hidden_description }, plan.name, plannerCtx.sceneSummary)
    if (hooks.length > 0) {
      await service.from('hooks').delete().eq('adventure_id', env.adventureId).eq('from_ref->>table', 'live')
      const { error: hookError } = await service.from('hooks').insert(hooks.map((h) => ({
        adventure_id: env.adventureId,
        from_ref: { table: 'live', id: null } as unknown as Json,
        to_objective_id: objective.id,
        hook_text: h.textSeed,
        kind: h.placement,
      })))
      assertOk(hookError, 'live hooks insert failed')
    }
  }

  // The beat-opening cutscene: exposition voice, hook telegraphing the authored encounter.
  await narrationBeat(
    service, env, sessionId,
    `${narrationContext ? `${narrationContext} ` : ''}Open the next story beat ("${plan.name}"). ` +
      `Establish these situations without resolving them: ${plan.goals.join(' / ')}. ` +
      `${plan.narrationSeed} Pick up from where the party actually stands - never presume travel ` +
      'or actions they did not take.' +
      (plan.encounter
        ? ` Telegraph the encounter ahead - "${plan.encounter.label}"` +
          `${plan.encounter.stakes ? ` (at stake: ${plan.encounter.stakes})` : ''} - and make the ` +
          'closing ask invite the party into it.'
        : ''),
    'Beat opened',
    'exposition',
  )
  return { status: 200, body: { ok: true, beat_id: beatRow.id, name: plan.name, braided: plan.braided.length } }
}

/** Condensed recent events for classifier context. */
async function condensedEvents(service: SupabaseClient, adventureId: string, limit: number): Promise<string[]> {
  const rows = await recentEventRows(service, adventureId, limit)
  return rows.map((e) => {
    const bits = ['text', 'kind', 'skill', 'name', 'tag'].map((k) => e.payload[k]).filter((v) => typeof v === 'string')
    return `${e.type}${bits.length > 0 ? `: ${bits.join(' ')}` : ''}`
  })
}

/**
 * Off-loop streak bookkeeping (F08 SS3): 3+ off-loop intents run the Loop Classifier. The
 * classifier only ever proposes; full-AI auto-accepts at high confidence and opens the pivoted
 * loop's first beat.
 */
export async function noteIntentForClassifier(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  kind: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const loops = await loadLoops(service, env.adventureId)
  const loop = activeLoop(loops)
  if (!loop) return null
  const state = (await loadState(service, env.adventureId)).state
  const previous = state.dm?.story?.offLoopStreak ?? 0
  const streak = nextStreak(previous, isOffLoop(intentPillar(kind), loop.type))
  if (streakTriggersClassifier(streak)) {
    await commitDiffs(service, env.adventureId, () => [{ domain: 'dm', patch: { story: { offLoopStreak: 0 } } }])
    return classifyAndHandle(service, env, sessionId)
  }
  if (streak !== previous) {
    await commitDiffs(service, env.adventureId, () => [{ domain: 'dm', patch: { story: { offLoopStreak: streak } } }])
  }
  return null
}

export async function classifyAndHandle(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const loops = await loadLoops(service, env.adventureId)
  const loop = activeLoop(loops)
  if (!loop) return { status: 409, body: { error: 'No active loop to classify against' } }
  const state = (await loadState(service, env.adventureId)).state
  const { data: beatRow } = loop.currentBeatId
    ? await service.from('beats').select('name').eq('id', loop.currentBeatId).maybeSingle()
    : { data: null }

  const assessment = await runLoopClassifier(env, {
    recentEvents: await condensedEvents(service, env.adventureId, 15),
    activeLoop: { type: loop.type, beatName: (beatRow?.name as string) ?? null },
    currentObjective: state.objectives.list.find((o) => o.id === state.objectives.currentId)?.title ?? null,
    sceneSummary: `${state.scene.locationName || 'unknown'} (${state.scene.mode})`,
  })
  const handling = pivotHandling(env.mode, assessment)
  if (handling === 'none') {
    await logEvent(service, env.adventureId, sessionId, 'loop_on_loop', { confidence: assessment.confidence })
    return { status: 200, body: { ok: true, resolved: 'on_loop', confidence: assessment.confidence } }
  }

  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'loop_pivot',
    payload: assessment as unknown as Json,
    mode: handling === 'auto_accept' ? 'auto' : 'human',
    summary: `pivot -> ${assessment.pivot!.newType} (${assessment.confidence.toFixed(2)}): ${assessment.pivot!.why.slice(0, 50)}`,
  })

  if (handling === 'wait_and_reevaluate') {
    await commitDiffs(service, env.adventureId, () => [
      { domain: 'dm', patch: { story: { offLoopStreak: -PIVOT_REEVALUATE_EVENTS } } },
    ])
    await logEvent(service, env.adventureId, sessionId, 'loop_pivot_deferred', {
      new_type: assessment.pivot!.newType, confidence: assessment.confidence,
    })
    return { status: 200, body: { ok: true, resolved: 'deferred' } }
  }
  if (handling === 'propose') {
    await logEvent(service, env.adventureId, sessionId, 'loop_pivot_proposed', {
      new_type: assessment.pivot!.newType, confidence: assessment.confidence,
    })
    return { status: 200, body: { ok: true, resolved: 'proposed' } }
  }

  // auto_accept (full-AI, confidence >= 0.8): apply the pivot and open the first beat.
  const pivot = assessment.pivot!
  const closed = pivot.actionOnCurrent === 'complete' ? completeLoop(loops, loop.id) : suspendLoop(loops, loop.id)
  if (!closed.ok) return { status: 500, body: { error: closed.error } }
  const pushed = pushLoop(closed.loops, { id: crypto.randomUUID(), type: pivot.newType, customLabel: null })
  if (!pushed.ok) return { status: 500, body: { error: pushed.error } }
  await persistLoops(service, env.adventureId, loops, pushed.loops)
  const newLoopId = pushed.loops[pushed.loops.length - 1].id
  await logEvent(service, env.adventureId, sessionId, 'loop_pivot_applied', {
    from: loop.type, to: pivot.newType, action_on_current: pivot.actionOnCurrent, confidence: assessment.confidence,
  })
  await planAndOpenBeat(service, env, sessionId, newLoopId, 'pivot')
  return { status: 200, body: { ok: true, resolved: 'pivoted', new_type: pivot.newType } }
}

export const DEFAULT_NUDGE_MINUTES = 3

/** Action wrapper: any member's client may sweep the idle timer; the server validates. */
export async function idleNudgeAction(service: SupabaseClient, adventureId: string, userId: string) {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value
  const env: AgentEnv = {
    service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode,
  }
  return idleNudge(service, env, play.sessionId)
}

/** Client-swept idle nudge (F08 SS9.1): one in-fiction nudge, never a plot advance. */
export async function idleNudge(service: SupabaseClient, env: AgentEnv, sessionId: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const state = (await loadState(service, env.adventureId)).state
  if (!['narration', 'roleplay', 'downtime', 'puzzle'].includes(state.scene.mode)) {
    return { status: 409, body: { error: 'No nudges in this scene mode' } }
  }
  if (state.dialogue.pending || state.dialogue.typing || state.dm?.pendingReview) {
    return { status: 409, body: { error: 'The table is not idle' } }
  }
  const { data: lastEvents, error } = await service
    .from('event_log')
    .select('type, created_at')
    .eq('adventure_id', env.adventureId)
    .order('id', { ascending: false })
    .limit(1)
  assertOk(error, 'event log load failed')
  const last = (lastEvents ?? [])[0] as { type: string; created_at: string } | undefined
  if (!last) return { status: 409, body: { error: 'Nothing has happened yet' } }
  // Escalation ladder, windowed by the last PLAYER action (the old "last event is idle_nudge"
  // guard never held - every nudge logs narration_published after itself and refired forever;
  // 13+ unattended nudges seen live on 2026-07-19). Nudge #1 re-vivifies the moment; continued
  // silence makes the world move once (#2, antagonist stirs); after that the table waits.
  const { data: activityRows, error: activityError } = await service
    .from('event_log')
    .select('id')
    .eq('adventure_id', env.adventureId)
    .in('type', ['intent_submitted', 'chat', 'say', 'check_rolled', 'offer_response', 'review_decided', 'social_started', 'demo_step', 'token_moved'])
    .order('id', { ascending: false })
    .limit(1)
  assertOk(activityError, 'event log load failed')
  const lastActivityId = (activityRows ?? [])[0]?.id as number | undefined
  let nudgeQuery = service
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId)
    .eq('type', 'idle_nudge')
  if (lastActivityId !== undefined) nudgeQuery = nudgeQuery.gt('id', lastActivityId)
  const { count: nudgesSince, error: nudgeError } = await nudgeQuery
  assertOk(nudgeError, 'event log load failed')
  if ((nudgesSince ?? 0) >= 2) {
    return { status: 409, body: { error: 'Already nudged - waiting on the players' } }
  }
  const thresholdMs = (dmSettings(state).nudgeMinutes ?? DEFAULT_NUDGE_MINUTES) * 60_000
  if (Date.now() - new Date(last.created_at).getTime() < thresholdMs) {
    return { status: 409, body: { error: 'The table is not idle yet' } }
  }

  // Phase-aware framing (encounter-states 4.1): mid-encounter the pressure lands inside the
  // encounter; in a cutscene the standing hook gets re-delivered.
  const encounter = state.encounter ?? null
  const phaseNote = encounter
    ? ` The party is mid-encounter ("${encounter.label}"${encounter.stakes ? ` - at stake: ${encounter.stakes}` : ''}): ` +
      'apply the pressure INSIDE it, reminding them what still hangs unresolved.'
    : ' Re-deliver the standing hook freshly - the same ask, made vivid again.'

  const escalate = (nudgesSince ?? 0) === 1
  await logEvent(service, env.adventureId, sessionId, 'idle_nudge', escalate ? { escalation: true } : {})
  if (escalate) {
    // The world does not wait: one antagonist turn plus an intrusion beat, then silence.
    try {
      await antagonistTurn(service, env, sessionId, 'idle_escalation')
    } catch (err) {
      console.error('idle escalation antagonist turn failed', err)
    }
    await narrationBeat(
      service, env, sessionId,
      'The players stayed quiet through one gentle prompt, so the world moves without them: ' +
        'let ONE small, real thing happen now - an arrival, a sound drawing closer, a change ' +
        'in the scene that hints at forces working off-stage. Raise the stakes of the standing ' +
        'choice without resolving it for the party and without revealing hidden information.' +
        phaseNote,
      'World stirs',
    )
    return { status: 200, body: { ok: true, resolved: 'escalated' } }
  }
  await narrationBeat(
    service, env, sessionId,
    'The players have gone quiet. Produce ONE small in-fiction nudge - an NPC speaks up, a ' +
      'distant sound, someone awaiting an answer presses gently. Do NOT advance the plot, ' +
      'resolve anything, or reveal new information.' + phaseNote,
    'Idle nudge',
  )
  return { status: 200, body: { ok: true, resolved: 'nudged' } }
}
