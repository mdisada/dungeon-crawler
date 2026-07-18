// Phase 6 story agents (F08 SS3, SS4, SS6, SS8, SS8.1): Loop Classifier, Beat Planner, live
// Hook Weaver, dial Summarizer, and the Meta Loop Steward. Demo adventures return canned,
// pattern-keyed outputs so fixtures and the integration suite spend nothing. Every output goes
// through the boundary parsers in _shared/story - the LLM proposes, the rules decide.

import { callAgentText } from '../_shared/llm.ts'
import {
  LOOP_TEMPLATES, parseBeatPlan, parsePivot,
} from '../_shared/story/index.ts'
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
  '"link": {"kind": "dc_mod"}, "skills": [skillA, skillB]}], "narration_seed": string}}. ' +
  'Predicates use atoms {"flag": name, "eq": value} | {"event": "exact marker text"} | ' +
  '{"fact": path, "eq"|"in": ...} with {"any": []}/{"all": []}. Braided pairs (two goals for ' +
  'different PCs whose outcomes modify each other) only when guidance asks for cooperation. ' +
  'The narration_seed must end at a concrete decision point facing the players.'

export interface PlannerContext {
  loop: { type: LoopType; completedBeatNames: string[] }
  objective: { title: string; hiddenDescription: string } | null
  sceneSummary: string
  partySummary: string
  poolIngredients: { id: string; type: string; reveals: string }[]
  varietyGuidance: string[]
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
    },
  }
}

export async function runBeatPlanner(env: AgentEnv, ctx: PlannerContext): Promise<BeatParseResult> {
  const raw = env.demo
    ? cannedBeatPlan(ctx)
    : await agentJson(env, 'beat_planner', PLANNER_SYSTEM, [
        `Loop: ${ctx.loop.type}; template ${LOOP_TEMPLATES[ctx.loop.type].beats.join(' -> ')}; completed beats: ${ctx.loop.completedBeatNames.join(', ') || 'none'}`,
        ctx.objective ? `Current objective: ${ctx.objective.title} (DM notes: ${ctx.objective.hiddenDescription})` : 'No active objective.',
        `Scene: ${ctx.sceneSummary}`,
        `Party: ${ctx.partySummary}`,
        `Undiscovered ingredient pool (reuse these before requesting new ones): ${ctx.poolIngredients.map((p) => `${p.type}: ${p.reveals}`).join(' | ') || 'empty'}`,
        ctx.varietyGuidance.length > 0 ? `Variety guidance:\n${ctx.varietyGuidance.join('\n')}` : '',
      ].filter(Boolean).join('\n'), 700)
  return parseBeatPlan(raw, ctx.plan)
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
