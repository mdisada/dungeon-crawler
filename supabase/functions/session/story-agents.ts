// Phase 6 story agents (F08 SS3, SS4, SS6, SS8, SS8.1): Loop Classifier, Beat Planner, live
// Hook Weaver, dial Summarizer, and the Meta Loop Steward. Demo adventures return canned,
// pattern-keyed outputs so fixtures and the integration suite spend nothing. Every output goes
// through the boundary parsers in _shared/story - the LLM proposes, the rules decide.

import { callAgentText } from '../_shared/llm.ts'
import {
  LOOP_TEMPLATES, parseBeatPlan, parsePivot,
} from '../_shared/story/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type {
  BeatParseResult, BeatPlanContext, LoopType, PivotAssessment,
} from '../_shared/story/index.ts'
import { agentJson } from './agents.ts'
import type { AgentEnv } from './agents.ts'

const CLASSIFIER_SYSTEM =
  'You classify what tabletop RPG players are actually doing against the active story loop. ' +
  'Reply with ONLY JSON: {"assessment": "on_loop"|"pivot", "confidence": 0..1, ' +
  '"pivot"?: {"new_type": string, "why": string, "suggested_first_beat": string, ' +
  '"action_on_current": "suspend"|"complete"}}. Loop types: mystery, monster_hunt, ' +
  'dungeon_crawl, siege_defense, infiltration, intrigue, rebellion, survival, escort, heist, ' +
  'custom. Pivot ONLY on clear sustained evidence (3+ actions pointing the same new way) - ' +
  'a single odd action is on_loop. Cite the evidence in "why".'

function cannedPivot(recentEvents: string[]): PivotAssessment {
  const text = recentEvents.join(' ').toLowerCase()
  if (/(barricade|siege|defend the|fortify)/.test(text)) {
    return parsePivot({
      assessment: 'pivot',
      confidence: /half-sure/.test(text) ? 0.7 : 0.9,
      pivot: { new_type: 'siege_defense', why: '[demo] players are fortifying', suggested_first_beat: 'preparation', action_on_current: 'suspend' },
    })
  }
  return parsePivot({ assessment: 'on_loop', confidence: 0.2 })
}

export interface ClassifierContext {
  recentEvents: string[]
  activeLoop: { type: LoopType; beatName: string | null }
  currentObjective: string | null
  sceneSummary: string
}

export async function runLoopClassifier(env: AgentEnv, ctx: ClassifierContext): Promise<PivotAssessment> {
  if (env.demo) return cannedPivot(ctx.recentEvents)
  try {
    const user = [
      `Active loop: ${ctx.activeLoop.type}${ctx.activeLoop.beatName ? ` (beat: ${ctx.activeLoop.beatName})` : ''}`,
      `Expected shape: ${LOOP_TEMPLATES[ctx.activeLoop.type].beats.join(' -> ')}`,
      `Current objective: ${ctx.currentObjective ?? 'none'}`,
      `Scene: ${ctx.sceneSummary}`,
      `Recent events (oldest first):\n${ctx.recentEvents.join('\n')}`,
    ].join('\n')
    return parsePivot(await agentJson(env, 'loop_classifier', CLASSIFIER_SYSTEM, user, 300))
  } catch {
    return parsePivot(null) // classifier outage = on_loop, never a blocked table
  }
}

const PLANNER_SYSTEM =
  'You are the Beat Planner for a tabletop RPG. Plan exactly ONE next beat. Goals are ' +
  'situations demanding a player decision, never events that happen to the party. Reply with ' +
  'ONLY JSON: {"beat": {"name": string, "goals": [1-4 strings], "exit_conditions": predicate, ' +
  '"ingredient_requests": [{"type": "clue"|"secret"|"event"|"item"|"rumor", "purpose": string, ' +
  '"pillar_tags": ["combat"|"social"|"exploration"]}], "braided": [{"goal_pair": [i, j], ' +
  '"link": {"kind": "dc_mod"}, "skills": [skillA, skillB]}], "narration_seed": string, ' +
  '"encounter": {"kind": "skill_challenge"|"social"|"puzzle"|"combat", "label": string, "stakes": string, ' +
  '"rationale": string, "on_success": [milestones], "on_partial": [milestones], ' +
  '"on_failure": [milestones]}}}. ' +
  'Exit predicates use ONLY atoms {"flag": "<snake_case_decision_or_milestone>", "eq": true} | ' +
  '{"event": "exact past-tense marker"} with {"any": []}/{"all": []} - NEVER "fact" atoms (live ' +
  'play cannot write them). Prefer an "any" of 2-4 flags so multiple player approaches exit the ' +
  'beat. Braided pairs (two goals for different PCs whose outcomes modify each other) only when ' +
  'guidance asks for cooperation. The narration_seed must end at a concrete decision point facing the players. ' +
  'ENCOUNTER: every beat carries exactly one typed encounter - the ONLY way this beat can ' +
  'resolve. Its outcome maps translate result tiers into milestones, and every entry MUST be ' +
  'copied EXACTLY from the objective milestones provided or from the atoms of your own ' +
  'exit_conditions (a full/partial success should exit the beat). Never invent milestone text. ' +
  'FAIL FORWARD: author exit_conditions as an "any" of BOTH a success atom AND a ' +
  'consequence/setback atom, and map on_failure to that setback atom - a failed encounter ' +
  'must still move the story (at a cost), never re-offer the same wall. Objective milestones ' +
  'must be copied CHARACTER-FOR-CHARACTER (keep spaces - never snake_case them), and when an ' +
  'objective milestone fits a tier, prefer it over your own exit atoms.'

export interface PlannerContext {
  loop: { type: LoopType; completedBeatNames: string[] }
  objective: { title: string; hiddenDescription: string } | null
  sceneSummary: string
  partySummary: string
  poolIngredients: { id: string; type: string; reveals: string }[]
  varietyGuidance: string[]
  /** Retrieved memory fragments (Slice 7) - what earlier sessions established. */
  establishedEarlier?: string[]
  plan: BeatPlanContext
}

function cannedBeatPlan(ctx: PlannerContext): unknown {
  const template = LOOP_TEMPLATES[ctx.loop.type]
  const name = template.beats[Math.min(ctx.loop.completedBeatNames.length, template.beats.length - 1)]
  const wantsCoop = ctx.varietyGuidance.some((g) => g.includes('cooperative'))
  const skills = ctx.plan.partySkills.slice(0, 2)
  return {
    beat: {
      name,
      goals: [
        `[demo] a situation forcing a choice during ${name}`,
        `[demo] a second thread the party can pull during ${name}`,
      ],
      exit_conditions: { event: `beat ${name} resolved` },
      ingredient_requests: [{ type: 'clue', purpose: `[demo] something pointing past ${name}`, pillar_tags: ['exploration'] }],
      braided: wantsCoop && ctx.plan.partySize > 1 && skills.length === 2
        ? [{ goal_pair: [0, 1], link: { kind: 'dc_mod' }, skills }]
        : [],
      narration_seed: `[demo seed] The ${name} beat opens; someone must decide what happens next.`,
      encounter: {
        kind: 'skill_challenge',
        label: `[demo] the ${name} challenge`,
        stakes: `[demo] the ${name} beat hangs on it`,
        rationale: 'demo',
        on_success: [`beat ${name} resolved`],
        on_partial: [`beat ${name} resolved`],
        on_failure: [],
      },
    },
  }
}

/**
 * `priorErrors` turns a retry into a REPAIR. A blind re-roll of the identical prompt is the
 * documented no-op ("the retry loop that looks like progress and does nothing"), and it is what
 * this agent used to do - the planner was never told which milestone it invented, so it
 * invented another. guide-pipeline's generateParsed already carries errors forward; this brings
 * the session-side planner in line. Empirically the first repair step captures most of the
 * achievable gain, so one guided attempt is worth more than several blind ones.
 */
export async function runBeatPlanner(
  env: AgentEnv,
  ctx: PlannerContext,
  priorErrors?: string[],
): Promise<BeatParseResult> {
  const repair = (priorErrors ?? []).length === 0
    ? ''
    : [
        'Your previous plan was REJECTED by the validator:',
        ...priorErrors!.slice(0, 8),
        'Fix exactly these problems. Outcome-map entries must be copied character-for-character ' +
          'from the milestone list above - if none fits a tier, leave that tier empty.',
      ].join('\n')
  const raw = env.demo
    ? cannedBeatPlan(ctx)
    : await agentJson(env, 'beat_planner', PLANNER_SYSTEM, [
        `Loop: ${ctx.loop.type}; template ${LOOP_TEMPLATES[ctx.loop.type].beats.join(' -> ')}; completed beats: ${ctx.loop.completedBeatNames.join(', ') || 'none'}`,
        ctx.objective ? `Current objective: ${ctx.objective.title} (DM notes: ${ctx.objective.hiddenDescription})` : 'No active objective.',
        `Objective milestones the outcome maps may copy (exact text): ${(ctx.plan.milestones ?? []).join(' | ') || 'none - map onto your own exit_conditions atoms'}`,
        `Scene: ${ctx.sceneSummary}`,
        `Party: ${ctx.partySummary}`,
        `Undiscovered ingredient pool (reuse these before requesting new ones): ${ctx.poolIngredients.map((p) => `${p.type}: ${p.reveals}`).join(' | ') || 'empty'}`,
        (ctx.establishedEarlier ?? []).length > 0
          ? `Established earlier (plan past these, never contradict them):\n${ctx.establishedEarlier!.map((m) => `- ${m}`).join('\n')}`
          : '',
        ctx.varietyGuidance.length > 0 ? `Variety guidance:\n${ctx.varietyGuidance.join('\n')}` : '',
      ].filter(Boolean).join('\n'), 900)
  return parseBeatPlan(raw, ctx.plan)
}

const DESIGNER_SYSTEM =
  'You are the Encounter Designer for a tabletop RPG. Fill in the mechanical parameters for ' +
  'one encounter, designed around WHO the party members are: their species traits, ' +
  'backgrounds, and quirks shape which approaches are promising (Darkvision makes a dark ' +
  'passage a dwarf\'s moment; a sailor background makes rigging trivial). Reply with ONLY ' +
  'JSON. For a skill_challenge: {"params": {"needed_successes": ' +
  '2-4, "max_failures": 2-3, "suggested_skills": [2-4 skills DRAWN FROM the party skill list], ' +
  '"trait_notes": one line naming which party traits bear on this encounter and how}}. ' +
  'For social: {"params": {"goal": string (what the conversation is FOR), "npc_names": [1-3 ' +
  'names COPIED from the NPC list], "exits": [2-4 of {"outcome": snake_case label, ' +
  '"description": one line of what reaching it looks like, "tier": "success"|"partial"|"failure"} ' +
  '- include at least one success and one failure exit]}}. For puzzle: {"params": {"solution": ' +
  'string (the SECRET answer, concrete and enactable), "steps": [2-4 of {"description": a ' +
  'discoverable sub-realization, "hint": one in-fiction nudge toward it}], "max_attempts": 2-4, ' +
  '"fail_consequence": {"kind": "spawn_encounter"|"cost"|"antagonist_step", "params": {}}}}. ' +
  'For combat: {"params": {}}. Scale needed_successes with party size (never above party size ' +
  '+ 2) and keep every encounter winnable but tense.'

/** Kind-specific params for an authored beat spec (called at planning time). */
export async function runEncounterDesigner(
  env: AgentEnv,
  spec: { kind: string; label: string; stakes: string; rationale: string },
  party: { size: number; skills: string[]; profiles?: string[] },
  npcNames: string[] = [],
): Promise<Json> {
  const fallback: Json = spec.kind === 'skill_challenge'
    ? {
        needed_successes: Math.min(3, party.size + 1),
        max_failures: 2,
        suggested_skills: party.skills.slice(0, 3),
      }
    : spec.kind === 'social'
      ? {
          goal: spec.label,
          npc_names: npcNames.slice(0, 1),
          exits: [
            { outcome: 'agreed', description: 'The NPC clearly commits to what the party asked.', tier: 'success' },
            { outcome: 'refused', description: 'The NPC firmly and finally declines.', tier: 'failure' },
          ],
        }
      : spec.kind === 'puzzle'
        ? {
            solution: `the way through "${spec.label}"`,
            steps: [
              { description: 'Understand what the mechanism responds to', hint: 'Something here reacts when touched.' },
              { description: 'Work out the correct order', hint: 'The wear marks suggest a sequence.' },
            ],
            max_attempts: 3,
            fail_consequence: { kind: 'antagonist_step', params: {} },
          }
        : {}
  if (env.demo) {
    return spec.kind === 'skill_challenge'
      ? { needed_successes: 1, max_failures: 3, suggested_skills: party.skills.slice(0, 2) }
      : fallback
  }
  try {
    const raw = await agentJson(env, 'encounter_designer', DESIGNER_SYSTEM, [
      `Encounter: ${spec.kind} - "${spec.label}"`,
      `Stakes: ${spec.stakes || 'unstated'}`,
      spec.rationale ? `Planner rationale: ${spec.rationale}` : '',
      `Party size: ${party.size}; party skills: ${party.skills.join(', ') || 'none listed'}`,
      (party.profiles ?? []).length > 0
        ? `Who the party members are (design around their traits):\n${party.profiles!.map((p) => `- ${p}`).join('\n')}`
        : '',
      spec.kind === 'social' ? `Named NPCs in the world: ${npcNames.join('; ') || 'none listed'}` : '',
    ].filter(Boolean).join('\n'), 450)
    const params = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).params : null)
    return (typeof params === 'object' && params !== null ? params : fallback) as Json
  } catch {
    return fallback // a designer outage degrades to sane defaults, never a blocked beat
  }
}

const ADHOC_DESIGNER_SYSTEM =
  'You are the Encounter Designer for a tabletop RPG. The players went off-script with a real ' +
  'endeavor of their own - give it structure as a small ad-hoc encounter, designed around WHO ' +
  'they are (species traits, backgrounds, quirks pick the promising approaches). Reply with ONLY ' +
  'JSON: {"kind": "skill_challenge"|"combat", "label": string (short), "stakes": string (what ' +
  'failing costs, one line), "params": {"needed_successes": 1-3, "max_failures": 2-3, ' +
  '"suggested_skills": [1-3 skills from the party list], "trait_notes": one line naming which ' +
  'party traits bear on this and how}}. Prefer skill_challenge; combat only ' +
  'when the endeavor IS a fight.'

export interface AdhocDesign {
  kind: 'skill_challenge' | 'combat'
  label: string
  stakes: string
  params: Json
}

/** Micro-encounter for an off-script endeavor (entry mapping 4.1b) - structure, not silence. */
export async function runAdhocDesigner(
  env: AgentEnv,
  endeavor: string,
  party: { size: number; skills: string[]; profiles?: string[] },
): Promise<AdhocDesign> {
  const fallback: AdhocDesign = {
    kind: 'skill_challenge',
    label: endeavor.slice(0, 60) || 'An improvised endeavor',
    stakes: 'Time and standing lost',
    params: { needed_successes: 2, max_failures: 2, suggested_skills: party.skills.slice(0, 2) },
  }
  if (env.demo) return { ...fallback, label: `[demo adhoc] ${endeavor.slice(0, 40)}` }
  try {
    const raw = await agentJson(env, 'encounter_designer', ADHOC_DESIGNER_SYSTEM, [
      `The endeavor: ${endeavor}`,
      `Party size: ${party.size}; party skills: ${party.skills.join(', ') || 'none listed'}`,
      (party.profiles ?? []).length > 0
        ? `Who the party members are (design around their traits):\n${party.profiles!.map((p) => `- ${p}`).join('\n')}`
        : '',
    ].filter(Boolean).join('\n'), 300)
    const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const kind = obj.kind === 'combat' ? 'combat' : 'skill_challenge'
    return {
      kind,
      label: typeof obj.label === 'string' && obj.label.trim() ? obj.label.trim().slice(0, 80) : fallback.label,
      stakes: typeof obj.stakes === 'string' ? obj.stakes.trim().slice(0, 160) : fallback.stakes,
      params: (typeof obj.params === 'object' && obj.params !== null ? obj.params : fallback.params) as Json,
    }
  } catch {
    return fallback
  }
}

const WEAVER_SYSTEM =
  'You are the live Hook Weaver for a tabletop RPG. Produce 1-3 hooks that PULL players toward ' +
  'the current objective from inside the current scene - never forced scenes. Reply with ONLY ' +
  'JSON: {"hooks": [{"placement": "npc_dialogue"|"scene_detail"|"rumor"|"event", "text_seed": ' +
  'string}]}. text_seed is one sentence of connective tissue the Narrator/NPCs can work in naturally.'

export interface LiveHook {
  placement: 'npc_dialogue' | 'scene_detail' | 'rumor' | 'event'
  textSeed: string
}

export async function runHookWeaverLive(
  env: AgentEnv,
  objective: { title: string; hiddenDescription: string },
  beatName: string,
  sceneSummary: string,
): Promise<LiveHook[]> {
  if (env.demo) {
    return [
      { placement: 'scene_detail', textSeed: `[demo hook] a detail pointing at "${objective.title}"` },
      { placement: 'rumor', textSeed: `[demo hook] someone mutters about ${beatName}` },
    ]
  }
  try {
    const raw = await agentJson(env, 'hook_weaver', WEAVER_SYSTEM, [
      `Objective: ${objective.title} (DM notes: ${objective.hiddenDescription})`,
      `Open beat: ${beatName}`,
      `Scene: ${sceneSummary}`,
    ].join('\n'), 300)
    const hooks = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).hooks : null)
    if (!Array.isArray(hooks)) return []
    return hooks.flatMap((h): LiveHook[] => {
      if (typeof h !== 'object' || h === null) return []
      const hook = h as Record<string, unknown>
      const placement = ['npc_dialogue', 'scene_detail', 'rumor', 'event'].find((p) => p === hook.placement)
      if (!placement || typeof hook.text_seed !== 'string' || !hook.text_seed.trim()) return []
      return [{ placement: placement as LiveHook['placement'], textSeed: hook.text_seed.trim() }]
    }).slice(0, 3)
  } catch {
    return []
  }
}

const DIALS_SYSTEM =
  'You maintain story trajectory dials for a tabletop RPG. Given the scene transcript and the ' +
  'dial definitions, nudge any dial that MOVED this scene. Reply with ONLY JSON: {"moves": ' +
  '[{"dial": key, "delta": -2..2, "why": "one line"}]}. +/-1 for a normal shift, +/-2 only for ' +
  'a defining moment. Most scenes move nothing.'

export interface DialMove {
  dial: string
  delta: number
  why: string
}

export async function runDialSummarizer(
  env: AgentEnv,
  dials: { key: string; name: string; description: string }[],
  transcript: string[],
): Promise<DialMove[]> {
  if (dials.length === 0) return []
  if (env.demo) {
    const text = transcript.join(' ').toLowerCase()
    return text.includes('spare') || text.includes('mercy')
      ? [{ dial: dials[0].key, delta: 1, why: '[demo] the party showed mercy' }]
      : []
  }
  try {
    const raw = await agentJson(env, 'summarizer', DIALS_SYSTEM, [
      `Dials: ${dials.map((d) => `${d.key} (${d.name}: ${d.description})`).join(' | ')}`,
      `Transcript:\n${transcript.join('\n')}`,
    ].join('\n'), 300)
    const moves = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).moves : null)
    if (!Array.isArray(moves)) return []
    const known = new Set(dials.map((d) => d.key))
    return moves.flatMap((m): DialMove[] => {
      if (typeof m !== 'object' || m === null) return []
      const move = m as Record<string, unknown>
      if (typeof move.dial !== 'string' || !known.has(move.dial)) return []
      const delta = Number(move.delta)
      if (!Number.isFinite(delta) || delta === 0) return []
      return [{ dial: move.dial, delta, why: typeof move.why === 'string' ? move.why : '' }]
    })
  } catch {
    return []
  }
}

const STEWARD_SYSTEM =
  'You run the antagonist\'s off-screen agenda in a tabletop RPG (the players never see this ' +
  'directly). Reply with ONLY JSON: {"step_progress": "advance"|"stall"|"setback", ' +
  '"off_screen_event": "one sentence of what the antagonist did", "surfacing": ' +
  '"rumor"|"scene_detail"|"npc_reaction", "surface_text": "how the players could notice"}. ' +
  'Progress follows the plan unless the party\'s visible impact says otherwise.'

export interface StewardTurn {
  stepProgress: 'advance' | 'stall' | 'setback'
  offScreenEvent: string
  surfacing: 'rumor' | 'scene_detail' | 'npc_reaction'
  surfaceText: string
}

export async function runSteward(
  env: AgentEnv,
  antagonist: string,
  plan: { steps: { summary: string; status: string }[]; current_step: number },
  partyImpact: string[],
): Promise<StewardTurn> {
  const fallback: StewardTurn = {
    stepProgress: 'advance',
    offScreenEvent: `[demo] ${antagonist || 'The antagonist'} quietly advances their plan.`,
    surfacing: 'rumor',
    surfaceText: '[demo] refugees carry a strange rumor',
  }
  if (env.demo) return fallback
  try {
    const raw = await agentJson(env, 'meta_loop_steward', STEWARD_SYSTEM, [
      `Antagonist: ${antagonist}`,
      `Plan: ${plan.steps.map((s, i) => `${i === plan.current_step ? '>> ' : ''}${s.summary} [${s.status}]`).join(' | ') || 'no explicit steps yet - infer one'}`,
      `Party's visible impact recently:\n${partyImpact.join('\n') || 'none'}`,
    ].join('\n'), 300)
    const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const stepProgress = ['advance', 'stall', 'setback'].find((s) => s === obj.step_progress)
    const surfacing = ['rumor', 'scene_detail', 'npc_reaction'].find((s) => s === obj.surfacing)
    if (!stepProgress || typeof obj.off_screen_event !== 'string') return fallback
    return {
      stepProgress: stepProgress as StewardTurn['stepProgress'],
      offScreenEvent: obj.off_screen_event,
      surfacing: (surfacing ?? 'rumor') as StewardTurn['surfacing'],
      surfaceText: typeof obj.surface_text === 'string' ? obj.surface_text : obj.off_screen_event,
    }
  } catch {
    return fallback
  }
}

const CLIMAX_SYSTEM =
  'You author the concrete climax of a tabletop RPG adventure from what ACTUALLY happened - ' +
  'the authored sketch was only illustrative. Write 3-5 sentences the Narrator will use to ' +
  'open the finale, grounded in the real event log and committed relationships, ending at a ' +
  'concrete decision point. Output only the text.'

export async function runClimaxAuthor(
  env: AgentEnv,
  ending: { title: string; description: string; tone: string },
  condensedEvents: string[],
): Promise<string> {
  if (env.demo) return `[demo climax] The story bends toward "${ending.title}" - and someone must choose.`
  try {
    return await callAgentText({
      serviceClient: env.service,
      openRouterApiKey: Deno.env.get('OPENROUTER_API_KEY') ?? '',
      userId: env.creatorId,
      adventureId: env.adventureId,
      agentRole: 'meta_loop_steward',
      system: CLIMAX_SYSTEM,
      user: [
        `Committed ending: ${ending.title} (${ending.tone}) - ${ending.description}`,
        `What actually happened (condensed):\n${condensedEvents.join('\n')}`,
      ].join('\n'),
      maxTokens: 400,
    })
  } catch {
    return `The threads draw together toward ${ending.title}.`
  }
}

const SUSPICION_SYSTEM =
  'A tabletop RPG player just spoke, and the line names one or more NPCs. Decide which of them ' +
  '- if any - the player is treating as untrustworthy, complicit, or behind what is going ' +
  'wrong. Reply with ONLY JSON: {"suspected": ["exact name", ...]}. Merely mentioning, ' +
  'greeting, asking after, or worrying ABOUT someone is NOT suspicion; accusation, distrust, ' +
  'or naming them as a culprit is. Return an empty array when in doubt.'

/**
 * Replaces a keyword list ("suspect|liar|traitor|...") that could not tell an accusation from
 * "is Fendel alright?". Called only once a registry NPC is actually named and no antagonist is
 * committed yet, so this stays a rare, small call rather than a per-utterance tax.
 */
export async function runSuspicionJudge(
  env: AgentEnv,
  utterance: string,
  npcNames: string[],
): Promise<string[]> {
  if (npcNames.length === 0) return []
  if (env.demo) {
    // The $0 suites still need a deterministic path - fixtures, not production semantics.
    const t = utterance.toLowerCase()
    return /(suspect|liar|lying|traitor|behind this|don'?t trust)/.test(t) ? npcNames : []
  }
  try {
    const raw = await agentJson(
      env, 'adjudicator', SUSPICION_SYSTEM,
      `NPCs named in the line: ${npcNames.join(', ')}\nPlayer said: "${utterance}"`,
      120,
    )
    const suspected = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).suspected : null)
    if (!Array.isArray(suspected)) return []
    const known = new Map(npcNames.map((n) => [n.toLowerCase(), n]))
    return [...new Set(
      suspected
        .filter((s): s is string => typeof s === 'string')
        .map((s) => known.get(s.toLowerCase().trim()))
        .filter((n): n is string => Boolean(n)),
    )]
  } catch {
    return [] // a judgement failure must never invent an antagonist
  }
}

const ARCHIVIST_SYSTEM =
  'You are the Archivist of a tabletop RPG session. You do NOT write prose - you record what ' +
  'just became true, so the game engine can act on it. Reply with ONLY JSON: ' +
  '{"milestones": ["exact text from the authored list"], "digest": "1-2 sentences: what ' +
  'changed and who did it", "npc_states": [{"name": "exact NPC name", ' +
  '"state": "dead"|"absent"|"present"}], ' +
  '"contributions": [{"name": "exact PC name", "did": "one clause"}], ' +
  '"contradictions": ["a claim in this scene that contradicts the established facts"]}.\n' +
  'Rules: milestones MUST be copied verbatim from the authored list - never invent one, and ' +
  'return an empty array if nothing on that list actually happened. Only report an npc_state ' +
  'the scene plainly established - and use "present" for anyone who has now ARRIVED or returned, ' +
  'which is what allows the game to bring them on stage. Only report a contradiction you can point at. When in doubt, ' +
  'return empty arrays - a missed record is recoverable, a false one corrupts the story.'

export interface ArchivistContext {
  /** What closed: 'encounter' | 'scene' | 'objective', plus its label. */
  phase: string
  label: string
  /** The authored milestone vocabulary - the ONLY milestones that may be claimed. */
  vocabulary: string[]
  /** Established facts the scene must not contradict. */
  facts: string[]
  transcript: string[]
  npcNames: string[]
  pcNames: string[]
  /** Declared story dials, so trajectory is judged in the same read as everything else. */
  dials: { key: string; name: string; description: string }[]
}

export interface ArchivistOutput {
  milestones: string[]
  digest: string
  npcStates: { name: string; state: 'dead' | 'absent' | 'alive' }[]
  contributions: { name: string; did: string }[]
  contradictions: string[]
  dials: DialMove[]
}

const EMPTY_LEDGER: ArchivistOutput = {
  milestones: [], digest: '', npcStates: [], contributions: [], contradictions: [], dials: [],
}

/**
 * The Archivist pass (scene ledger): runs at PHASE EXITS only - a handful of calls per session,
 * never per turn. It exists because progression had only two writers (outcome maps and the
 * adjudicator's scene_effects), so objectives almost never completed: 1 in 26 turns live.
 *
 * It cannot invent progress. Milestones are matched against the authored vocabulary by
 * applyMilestones, which drops anything off-list, so the worst a bad reply can do is nothing.
 */
export async function runArchivist(env: AgentEnv, ctx: ArchivistContext): Promise<ArchivistOutput> {
  if (ctx.vocabulary.length === 0 && ctx.transcript.length === 0) return EMPTY_LEDGER
  if (env.demo) {
    return {
      ...EMPTY_LEDGER,
      digest: `[demo] ${ctx.phase} "${ctx.label}" concluded.`,
    }
  }
  try {
    const raw = await agentJson(env, 'summarizer', ARCHIVIST_SYSTEM, [
      `Closed ${ctx.phase}: ${ctx.label}`,
      `Authored milestones (copy verbatim, or return none): ${ctx.vocabulary.join(' | ') || 'none'}`,
      `Established facts: ${ctx.facts.join(' | ') || 'none'}`,
      `NPCs: ${ctx.npcNames.join(', ') || 'none'}`,
      `Story dials (move only these, only when this phase clearly shifted one): ${
        ctx.dials.map((d) => `${d.key} (${d.name}: ${d.description})`).join(' | ') || 'none'}`,
      `PCs: ${ctx.pcNames.join(', ') || 'none'}`,
      `What happened:\n${ctx.transcript.join('\n')}`,
    ].join('\n'), 500)
    if (typeof raw !== 'object' || raw === null) return EMPTY_LEDGER
    const obj = raw as Record<string, unknown>
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string' && s.trim().length > 0) : []
    const known = new Set(ctx.npcNames.map((n) => n.toLowerCase()))
    const knownDials = new Set(ctx.dials.map((d) => d.key))
    const pcs = new Set(ctx.pcNames.map((n) => n.toLowerCase()))
    return {
      milestones: strings(obj.milestones),
      digest: typeof obj.digest === 'string' ? obj.digest.slice(0, 400) : '',
      npcStates: (Array.isArray(obj.npc_states) ? obj.npc_states : []).flatMap((s) => {
        if (typeof s !== 'object' || s === null) return []
        const row = s as Record<string, unknown>
        const name = typeof row.name === 'string' ? row.name : ''
        // "present" is the arrival case: an NPC authored as absent who has now walked on stage.
        // Without it, `absent` was a one-way door and the NPC could never be staged again - a
        // magistrate arrived in the fiction and stayed unstageable (live 2026-07-21).
        const raw = row.state
        const state = raw === 'dead' || raw === 'absent'
          ? raw
          : raw === 'present' || raw === 'alive'
            ? 'alive' as const
            : null
        // An unknown name means the model invented someone - drop it rather than guess.
        return name && state && known.has(name.toLowerCase()) ? [{ name, state }] : []
      }),
      contributions: (Array.isArray(obj.contributions) ? obj.contributions : []).flatMap((c) => {
        if (typeof c !== 'object' || c === null) return []
        const row = c as Record<string, unknown>
        const name = typeof row.name === 'string' ? row.name : ''
        const did = typeof row.did === 'string' ? row.did.slice(0, 160) : ''
        return name && did && pcs.has(name.toLowerCase()) ? [{ name, did }] : []
      }),
      contradictions: strings(obj.contradictions).slice(0, 5),
      dials: (Array.isArray(obj.dials) ? obj.dials : []).flatMap((d) => {
        if (typeof d !== 'object' || d === null) return []
        const row = d as Record<string, unknown>
        const key = typeof row.key === 'string' ? row.key : ''
        const delta = Number(row.delta)
        // Unknown keys are dropped like every other off-vocabulary claim; applyDialNudge clamps.
        if (!knownDials.has(key) || !Number.isFinite(delta) || delta === 0) return []
        return [{ dial: key, delta, why: typeof row.why === 'string' ? row.why : '' }]
      }),
    }
  } catch {
    return EMPTY_LEDGER // a failed ledger must never block the phase from closing
  }
}

const PROMOTER_SYSTEM =
  'A tabletop RPG party is stalled: several turns have passed with nothing to engage - no ' +
  'encounter open and nobody to talk to. Decide the ONE concrete thing the world should put in ' +
  'front of them, drawn from what already exists. Reply with ONLY JSON: ' +
  '{"action": "stage_npc"|"open_encounter"|"none", "npc_names": ["exact name"], ' +
  '"encounter_kind": "social"|"skill_challenge"|"puzzle"|"combat", "label": "short name", ' +
  '"why": "one clause tying it to what the players have been reaching for"}.\n' +
  'Read what the players actually typed: if they have been asking about a person, put that ' +
  'person in front of them ("stage_npc"). If they have been probing a place or an obstacle, ' +
  'open an encounter on it. Choose "none" only when the scene genuinely offers neither. ' +
  'Names must be copied exactly from the registry given; never invent one.'

export interface PromoterContext {
  recentInputs: string[]
  sceneSummary: string
  /** The standing hook, if the beat still offers one. */
  hook: string | null
  npcNames: string[]
  loopType: string
}

export interface PromotedOpening {
  action: 'stage_npc' | 'open_encounter' | 'none'
  npcNames: string[]
  encounterKind: 'social' | 'skill_challenge' | 'puzzle' | 'combat'
  label: string
  why: string
}

const NO_OPENING: PromotedOpening = {
  action: 'none', npcNames: [], encounterKind: 'skill_challenge', label: '', why: '',
}

/**
 * The stall promoter: loop-agnostic, and deliberately NOT a progression writer.
 *
 * When the party stalls, the fail-forward rung can only resolve an encounter that is already
 * open - during a cutscene it had nothing to resolve, so ten turns of "who did it" folded into
 * narration and the story never moved (live 2026-07-21). This decides what to PUT IN FRONT of
 * them instead. It grants no milestones and skips no spine: it opens the thing they were
 * already reaching for, and the normal encounter machinery takes it from there.
 */
export async function runStallPromoter(env: AgentEnv, ctx: PromoterContext): Promise<PromotedOpening> {
  if (env.demo) {
    return ctx.npcNames.length > 0
      ? { ...NO_OPENING, action: 'stage_npc', npcNames: [ctx.npcNames[0]], why: '[demo] stalled' }
      : NO_OPENING
  }
  try {
    const raw = await agentJson(env, 'adjudicator', PROMOTER_SYSTEM, [
      `Loop type: ${ctx.loopType}`,
      `Scene: ${ctx.sceneSummary}`,
      ctx.hook ? `Standing hook: ${ctx.hook}` : 'No standing hook.',
      `NPCs who exist (copy names exactly): ${ctx.npcNames.join(', ') || 'none'}`,
      `What the players have been typing (oldest first):\n${ctx.recentInputs.join('\n')}`,
    ].join('\n'), 250)
    if (typeof raw !== 'object' || raw === null) return NO_OPENING
    const obj = raw as Record<string, unknown>
    const action = obj.action === 'stage_npc' || obj.action === 'open_encounter' ? obj.action : 'none'
    const known = new Map(ctx.npcNames.map((n) => [n.toLowerCase(), n]))
    const npcNames = (Array.isArray(obj.npc_names) ? obj.npc_names : [])
      .filter((n): n is string => typeof n === 'string')
      .map((n) => known.get(n.trim().toLowerCase()))
      .filter((n): n is string => Boolean(n))
      .slice(0, 3)
    const kinds = ['social', 'skill_challenge', 'puzzle', 'combat'] as const
    return {
      action: action === 'stage_npc' && npcNames.length === 0 ? 'none' : action,
      npcNames,
      encounterKind: kinds.find((k) => k === obj.encounter_kind) ?? 'skill_challenge',
      label: typeof obj.label === 'string' ? obj.label.slice(0, 80) : '',
      why: typeof obj.why === 'string' ? obj.why.slice(0, 200) : '',
    }
  } catch {
    return NO_OPENING // a stalled table is bad; a broken one is worse
  }
}
