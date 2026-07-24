// F08 beat pacing: variety counting inputs, the Beat Planner open-beat flow (pool reuse before
// generation), the deterministic off-loop streak -> Loop Classifier trigger, and the idle
// nudge. Never imports story.ts (offer glue) - callers compose the two.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { dmSettings } from '../_shared/play/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'
import {
  activeLoop, advanceBeat, completeLoop, computeVarietyFlags, encounterKindGuidance,
  intentPillar, isOffLoop,
  listMilestoneAtoms, listPredicateAtomNames, LOOP_TEMPLATES, nextStreak, PIVOT_REEVALUATE_EVENTS,
  pivotHandling, pushLoop, registerLocalAtoms, resolveAtomText, resolveNpcNames,
  rewritePredicateAtoms, stageableNpcs, streakTriggersClassifier, suspendLoop, varietyGuidance,
} from '../_shared/story/index.ts'
import type {
  BeatPlan, CoreLoop, LoopStatus, LoopType, NpcStageRow, Pillar, RegistryAtom, VarietyInput,
} from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { minimalSatisfyingAtoms } from '../_shared/guide/guaranteed-route.ts'
import { parseStoredBeatSpec, runCombatPlaceholderEncounter } from './encounters.ts'
import { narrationBeat } from './narration.ts'
import { loadPartyCharacters, loadPlayContext, partyProfileLines, partySkillList } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { antagonistTurn } from './steward.ts'
import { retrieveMemories } from './memory.ts'
import {
  runBeatOutcomeMapper, runBeatPlanner, runEncounterDesigner, runHookWeaverLive, runLoopClassifier,
} from './story-agents.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

/**
 * Phase-2 rollout switch. false = the planner may not add cast; a social beat with nobody
 * stageable still downgrades deterministically (that half ships unflagged - it is strictly
 * safer than persisting an encounter that can never open).
 */
export const PLANNER_CREATES_NPCS = true

/**
 * Combat budget for one story: every adventure gets ONE major fight, plus up to two smaller
 * ones. These are adventurers - weapons, races, skills - so a story with no fight at all is the
 * wrong game for them; but real-time combat is the slowest thing at the table, so three is the
 * ceiling, not the target.
 *
 * A cap alone was not enough. Live 2026-07-23/24 the count landed anywhere between zero and
 * five, purely on the planner's whim - the plague run finished with NO fight, the heist opened
 * with two back to back. So the budget now has a floor as well as a ceiling: past the midpoint
 * of the objective ladder, a story that has not fought yet is steered into its major fight, and
 * at the finale it is required.
 */
export const COMBAT_BUDGET = 3
/** Fights that must happen before a story is allowed to end. */
export const COMBAT_FLOOR = 1

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
  const recentEncounterKinds = beatOpens
    .map((e) => String(e.payload.encounter_kind ?? ''))
    .filter(Boolean)
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
    recentEncounterKinds,
  }
}

async function activeObjectiveRow(service: SupabaseClient, state: GameState) {
  if (!state.objectives.currentId) return null
  const { data } = await service
    .from('objectives')
    .select('id, title, hidden_description, completion_predicates, guaranteed_route')
    .eq('id', state.objectives.currentId)
    .maybeSingle()
  return data as {
    id: string; title: string; hidden_description: string
    completion_predicates: Json; guaranteed_route: Json
  } | null
}

/** The rescue route's provably-satisfying atoms, for the fail-closed alignment (Phase 4). */
function guaranteedRouteAtoms(raw: Json): string[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const onSuccess = (raw as Record<string, Json>).onSuccess
  return Array.isArray(onSuccess) ? onSuccess.filter((a): a is string => typeof a === 'string') : []
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
  // Re-planning while an encounter is still open is legitimate (the director's rung 3 now fires
  // against a stalled one), but the new beat's encounter overwrites state.encounter and the old
  // one leaves no `encounter_resolved` behind. Say so, rather than letting it vanish - an
  // encounter that disappears without a trace is exactly what made the last stall unreadable.
  if (state.encounter) {
    await logEvent(service, env.adventureId, sessionId, 'encounter_abandoned', {
      label: state.encounter.label, kind: state.encounter.kind, trigger,
    }).catch(() => {})
  }
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
  // The loop template already declares the pillars it turns on; serve the starved ones.
  const guidance = [
    ...varietyGuidance(flags),
    ...encounterKindGuidance(LOOP_TEMPLATES[loop.type].pillars, variety.recentEncounterKinds ?? []),
  ]

  const profileLines = await partyProfileLines(service, party)
  // Outcome-map vocabulary: the active objective's authored atoms (the planner also maps
  // onto its own exit_conditions - the parser validates against both).
  const objectiveAtoms = listMilestoneAtoms(objective?.completion_predicates ?? null)
  // Retrieval memory (Slice 7): the planner plans past what earlier sessions established.
  const establishedEarlier = await retrieveMemories(
    service, env,
    `${objective?.title ?? loop.type} - ${state.scene.locationName || 'the current scene'}`,
  )
  // Who can actually take a stage right now (Phase 2). The planner sees ONLY these names, so
  // it cannot aim a social beat at a corpse; anyone else it needs goes through create_npcs.
  const { data: npcRoster } = await service
    .from('npcs')
    .select('id, name, initial_state, generated, role')
    .eq('adventure_id', env.adventureId)
  const npcRows: NpcStageRow[] = ((npcRoster ?? []) as {
    id: string; name: string; initial_state?: string | null; generated?: boolean | null
  }[]).map((n) => ({ id: n.id, name: n.name, initialState: n.initial_state, generated: n.generated }))
  const liveNpcStates = state.dm?.facts.npcStates ?? {}
  const livingCast = stageableNpcs(npcRows, liveNpcStates, { namedOnly: true })

  // Climax + combat budget (2026-07-24). Two facts steer the finale and the pacing.
  //
  // isClimax: the active objective is the LAST one the story has left, so this beat is the
  // set-piece everything built toward - not just another beat. The planner is told so, and the
  // combat budget reserves a slot for it.
  //
  // combatCount: real-time combat is slow at the table, so a one-shot gets 1-2 fights, no more -
  // and the last of them is saved for the climax. Nothing capped this before; combat landed
  // wherever the planner felt like it (live 2026-07-23: combat clustered at the START and the
  // ending was a skill check). The cap is enforced structurally below, not just requested.
  const { data: objectiveLadder } = await service
    .from('objectives').select('id, reveal_state').eq('adventure_id', env.adventureId)
  const ladder = (objectiveLadder ?? []) as { id: string; reveal_state: string }[]
  const remaining = ladder.filter((o) => o.reveal_state === 'hidden' || o.reveal_state === 'active')
  // A climax needs an ARC behind it, so it also requires that something already finished.
  // Without that clause `remaining <= 1` is true on turn ONE of any single-objective quest: the
  // opening beat got flagged as the finale, the combat floor forced it to a fight, the climax
  // auto-open resolved it, and the whole quest completed before the party acted. Caught by the
  // $0 suite (2026-07-24: "quest in the journal, active" came back already completed).
  const resolvedCount = ladder.length - remaining.length
  const isClimax = Boolean(objective) && remaining.length <= 1 && resolvedCount >= 1
  const livingBoss = stageableNpcs(
    ((npcRoster ?? []) as { id: string; name: string; initial_state?: string | null; generated?: boolean | null; role?: string | null }[])
      .filter((n) => n.role === 'boss')
      .map((n) => ({ id: n.id, name: n.name, initialState: n.initial_state, generated: n.generated })),
    liveNpcStates, { namedOnly: true },
  )[0] ?? null
  const combatGenre = LOOP_TEMPLATES[loop.type].pillars.includes('combat')
  const { count: combatRows } = await service
    .from('event_log').select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId).eq('type', 'encounter_opened').eq('payload->>kind', 'combat')
  const combatCount = combatRows ?? 0
  // Past the halfway mark of the objective ladder with no fight yet: this story still owes the
  // party its major fight, and the room to place it well is running out.
  const totalObjectives = (objectiveLadder ?? []).length
  const pastMidpoint = totalObjectives > 0 && remaining.length * 2 <= totalObjectives
  const owesMajorFight = combatCount < COMBAT_FLOOR && (pastMidpoint || isClimax)

  // The major fight the story still owes the party. Stated first so it outranks the rest.
  if (owesMajorFight) {
    guidance.push(
      `THIS STORY STILL OWES ITS MAJOR FIGHT. These are adventurers - armed, trained, and here ` +
        `for danger - and not one real battle has happened yet. Author a COMBAT encounter for ` +
        `this beat: the story's most dangerous physical threat` +
        `${livingBoss ? `, ideally ${livingBoss.name} or their strongest forces` : ''}. Make it ` +
        `matter - this is the fight the adventure is remembered for.`,
    )
  }

  if (isClimax) {
    // The finale is the peak, and its FORM follows the final objective - not the genre. A heist
    // climaxes on the escape, a dungeon on the boss; forcing a sword fight onto every story is
    // the generic-gameplay trap. So: make it the set-piece the objective calls for, name the
    // boss only IF this finale is about facing them, and say outright not to manufacture a
    // fight where the climax is an escape or a reckoning. Combat is one climax among many,
    // chosen by the story - EXCEPT when the story still owes its major fight, in which case the
    // finale is the last place it can happen.
    guidance.push(
      `THIS IS THE CLIMAX - the final objective and the peak the whole adventure has built ` +
        `toward. Author the set-piece THIS story calls for and pitch the stakes to their ` +
        `highest. ${combatGenre && livingBoss
          ? `If this finale is where the party faces ${livingBoss.name}, make it a decisive confrontation. `
          : ''}${owesMajorFight
          ? 'This finale must also BE the major fight - it is the last chance for one. '
          : `Do NOT force a battle where the story's climax is an escape, a reckoning, a choice ` +
            `or a revelation - fit the form to the moment. `}`,
    )
  } else if (combatCount >= COMBAT_BUDGET) {
    guidance.push(
      `Do NOT author a combat encounter for this beat. The party's combat for this story is ` +
        `spent (real-time fights are slow) - resolve tension through skill, social or puzzle play.`,
    )
  }

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
    livingCast: livingCast.map((n) => n.name),
    plan: {
      partySize: party.length,
      partySkills: partySkillList(party),
      milestones: [...objectiveAtoms.flags, ...objectiveAtoms.events, ...objectiveAtoms.facts],
    },
  }
  // A THROWN planner error used to escape this function and leave the loop beatless; the parsed
  // failure path below has a deterministic template fallback, so route transport failures into
  // it rather than letting them stop the story.
  const planFailed = (why: string) => ({ ok: false as const, errors: [why] })
  let parsed = await runBeatPlanner(env, plannerCtx).catch(() => planFailed('beat planner call failed'))
  // One GUIDED repair, not a blind re-roll: the first repair step captures the bulk of the
  // achievable gain, and re-rolling the same prompt is what produced the invented milestone
  // that stalled the loop (live 2026-07-21).
  if (!parsed.ok) {
    parsed = await runBeatPlanner(env, plannerCtx, parsed.errors)
      .catch(() => planFailed('beat planner repair call failed'))
  }
  let plan: BeatPlan = parsed.ok
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
        localAtoms: [],
        createNpcs: [],
      }
  if (!parsed.ok) {
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'beat_planner_failure', errors: parsed.errors as unknown as Json,
    })
  }

  // Register the declared local atoms (Phase 1) - the only door runtime atom creation has.
  // Collisions reuse the existing atom (spine preferred), and the exit predicate is rewritten
  // to registry labels so stored predicates never hold undeclared variants.
  const { data: registryRows } = await service
    .from('story_atoms')
    .select('slug, kind, scope, label')
    .eq('adventure_id', env.adventureId)
  const registration = registerLocalAtoms(plan.localAtoms, (registryRows ?? []) as RegistryAtom[])
  const objectiveVocab = plannerCtx.plan.milestones
  const atomMapping = new Map(registration.mapping)
  const localLabels = [...new Set(plan.localAtoms.map((a) => atomMapping.get(a.name)).filter((l): l is string => !!l))]
  if (plan.exitConditions != null) {
    // Every predicate atom rewrites to a registry label by CANONICAL lookup - the parser
    // accepted variant spellings of declared atoms (canonical equality), so keying the rewrite
    // on exact declared names alone left "scholars_trust_won" stored while the registered label
    // read "scholar's_trust_won", and the beat's own success flag could never match it
    // (adversarial review, 2026-07-22). Spine and just-registered labels share one index.
    for (const name of listPredicateAtomNames(plan.exitConditions)) {
      if (atomMapping.has(name)) continue
      const resolution = resolveAtomText(name, [...objectiveVocab, ...localLabels])
      if (resolution.ok && resolution.text !== name) atomMapping.set(name, resolution.text)
    }
    plan = { ...plan, exitConditions: rewritePredicateAtoms(plan.exitConditions, atomMapping) as Json }
  }
  if (registration.rejected.length > 0) {
    await logEvent(service, env.adventureId, sessionId, 'atom_registration_rejected', {
      rejected: registration.rejected as unknown as Json,
    })
  }

  // Requested cast (Phase 2, the "Elara" fix): a social beat that needs somebody the roster
  // lacks gets them CREATED before the designer runs, instead of naming a person who exists
  // only in prose and can never be staged.
  const castForBeat = [...livingCast]
  if (PLANNER_CREATES_NPCS && plan.encounter?.kind === 'social' && plan.createNpcs.length > 0) {
    const existing = new Set(npcRows.map((n) => n.name.toLowerCase().trim()))
    const wanted = plan.createNpcs.filter((n) => !existing.has(n.name.toLowerCase().trim()))
    if (wanted.length > 0) {
      const { data: created, error: createError } = await service
        .from('npcs')
        .insert(wanted.map((n) => ({
          adventure_id: env.adventureId,
          name: n.name,
          role: 'npc',
          // Real cast, not a throwaway bystander: generated=true would hide them from the
          // stall promoter and the rest of the cast machinery.
          generated: false,
          initial_state: 'alive',
          personality: { summary: n.personality } as unknown as Json,
          description: n.personality,
        })))
        .select('id, name')
      if (createError) console.error('planner npc create failed', createError)
      for (const row of ((created ?? []) as { id: string; name: string }[])) {
        castForBeat.push({ id: row.id, name: row.name, initialState: 'alive', generated: false })
      }
      if ((created ?? []).length > 0) {
        await logEvent(service, env.adventureId, sessionId, 'beat_npcs_created', {
          npcs: (created ?? []).map((n) => (n as { name: string }).name) as unknown as Json,
          beat: plan.name,
        })
      }
    }
  }

  // The Encounter Designer fills kind-specific mechanics; the outcome mapper (call 2) maps
  // tiers onto the closed menu of registered atoms; stored snake_case on the beat row.
  let encounterSpec: Json = null
  if (plan.encounter) {
    // Living cast only. The designer's enum used to be the FULL registry, so it could name a
    // dead or absent NPC that passed generation and died at open time (live 2026-07-22).
    const npcNames = plan.encounter.kind === 'social' ? castForBeat.map((n) => n.name) : []
    // Anti-repeat (Phase 4): the last few beats' shapes leave the menu, so the same template
    // never lands twice running. Kind-level variety alone was not enough to stop encounters
    // reading the same.
    const { data: recentSpecs } = await service
      .from('beats')
      .select('encounter_spec')
      .eq('core_loop_id', loop.id)
      .order('index', { ascending: false })
      .limit(3)
    const recentTemplates = ((recentSpecs ?? []) as { encounter_spec: Json }[])
      .map((b) => {
        const spec = b.encounter_spec
        if (typeof spec !== 'object' || spec === null || Array.isArray(spec)) return null
        const params = (spec as Record<string, Json>).params
        if (typeof params !== 'object' || params === null || Array.isArray(params)) return null
        const key = (params as Record<string, Json>).template
        return typeof key === 'string' ? key : null
      })
      .filter((k): k is string => Boolean(k))

    // Combat budget, enforced not just requested. A non-climax combat past the budget is
    // downgraded to a skill challenge - the planner's guidance can be ignored, this cannot. The
    // climax's combat slot is reserved: it is never capped, so the finale can always be a fight.
    if (plan.encounter.kind === 'combat' && !isClimax && combatCount >= COMBAT_BUDGET) {
      plan.encounter.kind = 'skill_challenge'
      await logEvent(service, env.adventureId, sessionId, 'combat_capped', {
        beat: plan.name, combat_so_far: combatCount, budget: COMBAT_BUDGET,
      })
    }
    // The floor, enforced the same way. At the FINALE with no fight yet, this is the last beat
    // that can carry one, so it becomes combat whatever the planner chose - a party of
    // adventurers should not finish a whole adventure without once drawing steel. Only at the
    // climax: before that the guidance gets to persuade, and the story keeps its shape.
    if (!env.demo && plan.encounter.kind !== 'combat' && isClimax && combatCount < COMBAT_FLOOR) {
      plan.encounter.kind = 'combat'
      await logEvent(service, env.adventureId, sessionId, 'combat_floor_forced', {
        beat: plan.name, was: 'non-combat', combat_so_far: combatCount, floor: COMBAT_FLOOR,
      })
    }
    if (isClimax) {
      await logEvent(service, env.adventureId, sessionId, 'climax_beat', {
        beat: plan.name, kind: plan.encounter.kind,
        boss: combatGenre && livingBoss ? livingBoss.name : null,
      })
    }

    const params = await runEncounterDesigner(env, plan.encounter, {
      size: party.length,
      skills: partySkillList(party),
      profiles: profileLines,
    }, npcNames, recentTemplates)
    const maps = await runBeatOutcomeMapper(env, {
      beatName: plan.name,
      goals: plan.goals,
      encounter: { kind: plan.encounter.kind, label: plan.encounter.label, stakes: plan.encounter.stakes },
      spineAtoms: objectiveVocab,
      localAtoms: localLabels,
    })
    // Deterministic spine guarantee (replaces the old LLM alignment-repair call): a full
    // success MUST credit the current objective. Live 2026-07-21, court: six beats resolved on
    // atoms of their own invention and "party_met_lord_cassian" was never touched. If the
    // mapper's on_success credits no objective atom, code appends the first one - the planner
    // was already instructed to make the beat about it.
    if (objectiveVocab.length > 0 && !maps.onSuccess.some((a) => objectiveVocab.includes(a))) {
      // Fail CLOSED (Phase 4): prefer the objective's code-authored rescue atoms - they are
      // the provably-satisfying set - and fall back to the first objective atom only when no
      // guaranteed route exists. Either way the beat credits the objective on a full success;
      // shipping a beat that cannot is how six beats resolved and the objective never moved.
      const routeAtoms = guaranteedRouteAtoms(objective?.guaranteed_route ?? null)
      const appended = routeAtoms.length > 0 ? routeAtoms : [objectiveVocab[0]]
      for (const atom of appended) if (!maps.onSuccess.includes(atom)) maps.onSuccess.push(atom)
      await logEvent(service, env.adventureId, sessionId, 'beat_alignment_forced', {
        appended: appended as unknown as Json,
        source: routeAtoms.length > 0 ? 'guaranteed_route' : 'objective_vocab',
        mapped: maps.onSuccess as unknown as Json,
      })
    }
    // The CLIMAX must be able to finish the story it ends. One objective atom is enough for an
    // `any` predicate but not for an `all` chain, and the guarantee above only requires one -
    // so a finale could credit half a conjunction and leave its own objective unfinished.
    //
    // Live 2026-07-24, heist: obj2 needed manifest_secured AND party_escaped_tidal_vault; the
    // boss fight credited party_escaped_tidal_vault (plus a local `secured_ledgers` that was
    // NOT the objective's atom), the objective stayed open, the beat re-planned, and the climax
    // fired FOUR times - three boss fights and no ending. Winning the finale has to end it.
    if (isClimax) {
      const satisfying = minimalSatisfyingAtoms(objective?.completion_predicates ?? null) ?? []
      const missing = satisfying.filter((a) => !maps.onSuccess.includes(a))
      if (missing.length > 0) {
        maps.onSuccess.push(...missing)
        await logEvent(service, env.adventureId, sessionId, 'climax_alignment_forced', {
          beat: plan.name, appended: missing as unknown as Json,
          mapped: maps.onSuccess as unknown as Json,
        })
      }
    }
    if (maps.dropped.length > 0) {
      await logEvent(service, env.adventureId, sessionId, 'beat_outcome_dropped', {
        dropped: maps.dropped as unknown as Json,
      })
    }
    // Resolve NPC NAMES to IDS here, at plan time, against the living cast only. Resolution
    // used to happen at open time inside openSocialEncounter, so an unresolvable name produced
    // a STILLBORN beat: the encounter could never open, so it could never be "spent", so
    // nothing ever re-planned it and the objective became unreachable (live 2026-07-22).
    let kind = plan.encounter.kind
    let resolvedParams = params
    if (kind === 'social') {
      const paramsObj = (typeof params === 'object' && params !== null && !Array.isArray(params)
        ? params
        : {}) as Record<string, Json>
      const wanted = Array.isArray(paramsObj.npc_names)
        ? (paramsObj.npc_names as Json[]).filter((v): v is string => typeof v === 'string')
        : []
      const { ids, unresolved } = resolveNpcNames(wanted, castForBeat)
      if (ids.length > 0) {
        resolvedParams = { ...paramsObj, npc_ids: ids as unknown as Json } as Json
        if (unresolved.length > 0) {
          await logEvent(service, env.adventureId, sessionId, 'beat_npcs_unresolved', {
            unresolved: unresolved as unknown as Json, staged: ids.length,
          })
        }
      } else {
        // Nobody stageable: downgrade DETERMINISTICALLY rather than persist an encounter that
        // can never open. The tier bridge makes this lossless for the spine - the same outcome
        // maps ride a skill challenge instead of a conversation.
        kind = 'skill_challenge'
        resolvedParams = { needed_successes: 2, max_failures: 2, suggested_skills: partySkillList(party).slice(0, 3) } as unknown as Json
        await logEvent(service, env.adventureId, sessionId, 'incident', {
          kind: 'beat_downgraded_unstageable', label: plan.encounter.label,
          wanted: wanted as unknown as Json, living_cast: castForBeat.length,
        })
      }
    }
    encounterSpec = {
      kind,
      label: plan.encounter.label,
      stakes: plan.encounter.stakes,
      rationale: plan.encounter.rationale,
      params: resolvedParams,
      on_success: maps.onSuccess,
      on_partial: maps.onPartial,
      on_failure: maps.onFailure,
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

  // Registry rows for the atoms this beat created (Phase 1). Best-effort: the beat is already
  // open and its predicates hold the canonical labels; a registry insert hiccup must not stop
  // the story (the upsert also absorbs a slug another session registered concurrently).
  if (registration.created.length > 0) {
    const { error: atomError } = await service.from('story_atoms').upsert(
      registration.created.map((a) => ({
        adventure_id: env.adventureId, slug: a.slug, kind: a.kind, scope: 'local', label: a.label,
        source_table: 'beats', source_id: beatRow.id as string,
      })),
      { onConflict: 'adventure_id,slug', ignoreDuplicates: true },
    )
    if (atomError) console.error('story_atoms local insert failed', atomError)
  }

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
    // The beat's OWN encounter, so a spent beat can be told apart from one whose party merely
    // wandered into an ad-hoc fight. Without it, any resolved encounter looks like the beat's.
    encounter_label: plan.encounter?.label ?? null,
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

  // A finale should FEEL like a finale, whatever shape it takes. The climax framing is
  // type-agnostic ON PURPOSE: the climax of a heist is the escape, of a court the verdict, of a
  // dungeon the boss - forcing every story to peak on a sword fight is the "generic gameplay"
  // trap. So this raises the stakes and names the moment without presuming combat; the beat's
  // own kind (a fight, an escape, a reckoning, a choice) supplies the form.
  const climaxFraming = isClimax
    ? 'THIS IS THE CLIMAX - the culmination the entire adventure has built toward. Pitch the ' +
      'stakes at their absolute peak and make the pressure that has been mounting now immediate ' +
      'and unmistakable. Frame this as the decisive, final moment - whatever its form: a ' +
      'confrontation, a desperate escape, a reckoning, an irreversible choice. The party must ' +
      'FEEL that everything has led here. '
    : ''

  // The beat-opening cutscene: exposition voice, hook telegraphing the authored encounter.
  await narrationBeat(
    service, env, sessionId,
    `${narrationContext ? `${narrationContext} ` : ''}${climaxFraming}Open the next story beat ("${plan.name}"). ` +
      `Establish these situations without resolving them: ${plan.goals.join(' / ')}. ` +
      `${plan.narrationSeed} Pick up from where the party actually stands - never presume travel ` +
      'or actions they did not take.' +
      (plan.encounter
        ? ` Telegraph the ${isClimax ? 'FINAL confrontation' : 'encounter'} ahead - "${plan.encounter.label}"` +
          `${plan.encounter.stakes ? ` (at stake: ${plan.encounter.stakes})` : ''} - and make the ` +
          'closing ask invite the party into it.'
        : ''),
    'Beat opened',
    'exposition',
  )

  // The climax's boss fight opens ITSELF. Every other beat's encounter waits for the party to
  // commit to it (the entry='offered' tier bridge) - fine mid-story, wrong for the finale.
  // Live 2026-07-24, heist: the climax beat "Confronting Silas Vane" was staged correctly as
  // combat, but the party spent its last turns on the approach and never took an action that
  // read as "attack the boss", so the confrontation the whole story built toward never opened.
  // A climax should not depend on the players guessing to swing first. Combat only (a placeholder
  // auto-win today, the battle map at F09): a social or skill climax is meant to be PLAYED, so it
  // still waits for the party. Opening it here runs the lead-in -> resolution -> aftermath, whose
  // on_success credits the final objective and lets the ending commit.
  // `!env.demo` for the same reason the Progress Director skips demo adventures: the $0 suites
  // are scripted, and an unsolicited auto-resolve advances their beats out from under their
  // assertions (2026-07-24: it cascaded the siege fixture four beats deep in one turn).
  // `combatCount < COMBAT_BUDGET` is the loop stop. A climax that re-plans (because its
  // objective did not complete) would otherwise auto-open a fresh boss fight every single time -
  // three in one run before the alignment fix above closed the underlying cause. The budget
  // ceiling doubles as the backstop if a finale ever churns again.
  if (!env.demo && isClimax && plan.encounter?.kind === 'combat' && encounterSpec
      && combatCount < COMBAT_BUDGET) {
    const spec = parseStoredBeatSpec(encounterSpec)
    if (spec) {
      await runCombatPlaceholderEncounter(
        service, env, sessionId, spec,
        'The party reaches the heart of the matter - the final confrontation is upon them.',
      ).catch((err) => console.error('climax combat open failed', err))
    }
  }
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

  // Phase 3 note: this ladder stays separate from the Progress Director on purpose. The
  // director counts TURNS (the party is acting but not progressing); the nudge measures
  // WALL-CLOCK silence (nobody is acting at all) and is capped at 2, so the two never
  // compete. Merging them would also make beats.ts import director.ts, which imports
  // planAndOpenBeat from here - a module cycle this file has always avoided.
  if (escalate) {
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
