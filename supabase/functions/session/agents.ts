// Phase 5 agent calls (Adjudicator F07 SS3.3, social classifier + NPC Agent F10 SS3,
// Narrator, Consistency Checker F07 SS6). Demo adventures (demo=true) return canned,
// pattern-keyed outputs so the scripted walkthrough and the integration suite spend nothing -
// including deliberately adversarial fixtures (over-reveal, dead-NPC narration) that exercise
// the server-side guardrails.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { AgentCallError, callAgentText } from '../_shared/llm.ts'
import {
  extractJson, parseAdjudication, parseConsistency, parseGists, parseNarrationOptions,
  parseNpcOutput, parseSocialClassification,
} from '../_shared/play/index.ts'
import type {
  AdjudicationOutput, ConsistencyVerdict, NpcAgentOutput, SocialClassification,
} from '../_shared/play/index.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''

export interface AgentEnv {
  service: SupabaseClient
  adventureId: string
  creatorId: string
  demo: boolean
  /** Adventure mode - the Slice 2 review gate only ever engages for 'assist'. */
  mode: 'full_ai' | 'assist' | null
}

async function agentJson(env: AgentEnv, role: string, system: string, user: string, maxTokens: number): Promise<unknown> {
  const text = await callAgentText({
    serviceClient: env.service,
    openRouterApiKey: OPENROUTER_API_KEY,
    userId: env.creatorId,
    adventureId: env.adventureId,
    agentRole: role,
    system,
    user,
    maxTokens,
  })
  return extractJson(text)
}

export interface AdjudicatorContext {
  intentText: string
  actorSummary: string
  sceneSummary: string
  objective: { title: string; hiddenDescription: string } | null
  partySkills: string[]
  partySize: number
  recentEvents: string[]
}

function cannedAdjudication(text: string, partySkills: string[]): AdjudicationOutput {
  const t = text.toLowerCase()
  const base = { interpretation: `[demo] ${text}`, flags: { impossible: false, needsDm: false } }
  const check = (spec: Record<string, unknown>) =>
    parseAdjudication(
      { ...base, resolution: { type: 'check', check: spec, consequences_hint: 'demo consequences' } },
      partySkills,
    )
  if (t.includes('impossible')) {
    return { ...base, flags: { impossible: true, needsDm: false }, resolution: { type: 'auto_fail', check: null, consequencesHint: 'cannot be done' } }
  }
  if (t.includes('together') || t.includes('we all')) {
    const out = check({ skill: 'stealth', dc: 12, adv_dis: 'none', rationale: 'group effort', group: true })
    if (out.ok) return out.data
  }
  if (t.includes('hold the gate') || t.includes('brace')) {
    const out = check({ skill: 'athletics', dc: 14, adv_dis: 'none', rationale: 'needs a second pair of hands', requires_assist: { skill: 'athletics', effect: 'enable' } })
    if (out.ok) return out.data
  }
  if (t.includes('boost') || t.includes('distract the guard')) {
    const out = check({ skill: 'stealth', dc: 13, adv_dis: 'none', rationale: 'someone can cover you', requires_assist: { skill: 'athletics', effect: 'bonus' } })
    if (out.ok) return out.data
  }
  if (t.includes('climb') || t.includes('vault') || t.includes('leap')) {
    const out = check({ skill: 'athletics', dc: 12, adv_dis: 'none', rationale: 'physical effort' })
    if (out.ok) return out.data
  }
  if (t.includes('search') || t.includes('investigate')) {
    const out = check({ skill: 'investigation', dc: 12, adv_dis: 'none', rationale: 'hidden detail' })
    if (out.ok) return out.data
  }
  return { ...base, resolution: { type: 'auto_success', check: null, consequencesHint: 'it simply works' } }
}

const ADJUDICATOR_SYSTEM =
  'You adjudicate free-text player actions in a D&D 5e-style game. Reply with ONLY JSON: ' +
  '{"interpretation": string, "resolution": {"type": "auto_success"|"auto_fail"|"check", ' +
  '"check"?: {"skill": string, "dc": number (5-25), "adv_dis": "none"|"advantage"|"disadvantage", ' +
  '"rationale": string, "group"?: boolean, "requires_assist"?: {"skill": string, "effect": "enable"|"bonus"}}, ' +
  '"consequences_hint": string}, "flags": {"impossible"?: boolean, "needs_dm"?: boolean}}. ' +
  'Trivial actions auto-succeed - never demand rolls for everything. Use "group": true for ' +
  'whole-party actions. Only spec requires_assist with a skill from the party skill list.'

export async function runAdjudicator(env: AgentEnv, ctx: AdjudicatorContext): Promise<AdjudicationOutput> {
  if (env.demo) return cannedAdjudication(ctx.intentText, ctx.partySkills)
  const user = [
    `Action: ${ctx.intentText}`,
    `Actor: ${ctx.actorSummary}`,
    `Scene: ${ctx.sceneSummary}`,
    ctx.objective ? `Current objective: ${ctx.objective.title} (DM notes: ${ctx.objective.hiddenDescription})` : '',
    `Party size: ${ctx.partySize}; party skills: ${ctx.partySkills.join(', ')}`,
    `Recent events: ${ctx.recentEvents.join(' | ') || 'none'}`,
  ].filter(Boolean).join('\n')
  const parsed = parseAdjudication(await agentJson(env, 'adjudicator', ADJUDICATOR_SYSTEM, user, 500), ctx.partySkills)
  if (!parsed.ok) throw new AgentCallError(`Adjudicator output invalid: ${parsed.errors.join('; ')}`)
  return parsed.data
}

function cannedClassification(text: string): SocialClassification {
  const t = text.toLowerCase()
  if (/(convince|persuade|please|beg|let us)/.test(t)) return { kind: 'influence', skill: 'persuasion', magnitude: 'reasonable' }
  if (/(lie|swear|pretend|totally)/.test(t)) return { kind: 'influence', skill: 'deception', magnitude: 'costly' }
  if (/(threat|or else|last chance)/.test(t)) return { kind: 'influence', skill: 'intimidation', magnitude: 'costly' }
  if (/(read|sense|study|size up)/.test(t)) return { kind: 'insight', skill: 'insight' }
  return { kind: 'conversation' }
}

const CLASSIFIER_SYSTEM =
  'Classify a player utterance to an NPC. Reply with ONLY JSON: {"kind": "conversation"} for plain talk, ' +
  '{"kind": "insight"} when they probe what the NPC hides/feels, or {"kind": "influence", ' +
  '"skill": "persuasion"|"deception"|"intimidation", "magnitude": "trivial"|"reasonable"|"costly"|"against_nature"} ' +
  'when they push the NPC to act/agree. Magnitude = how big the ask is for THIS npc. Most talk is plain conversation.'

export async function runSocialClassifier(env: AgentEnv, utterance: string, npcSummary: string): Promise<SocialClassification> {
  if (env.demo) return cannedClassification(utterance)
  try {
    return parseSocialClassification(
      await agentJson(env, 'adjudicator', CLASSIFIER_SYSTEM, `NPC: ${npcSummary}\nUtterance: ${utterance}`, 120),
    )
  } catch {
    return { kind: 'conversation' } // classification failure = no roll, never a blocked table
  }
}

export interface NpcContext {
  npc: { id: string; name: string; personality: string; description: string; faction: string }
  dispositionByPc: Record<string, number>
  memory: string[]
  knowledge: { id: string; reveals: string; condition: string | null }[]
  conversation: { topicStack: string[]; revealedThisScene: string[] }
  utterance: { actorCharacterId: string; actorName: string; text: string }
  checkResult: { skill: string; success: boolean; margin: number } | null
  pcs: { characterId: string; name: string; linesThisScene: number }[]
  hooks: string[]
  /** Consistency-regen constraints ("NEVER: ..."), set on the second attempt only. */
  constraint?: string
  /** DM-chosen gist (Slice 2 review console): the reply must follow this direction. */
  direction?: string
}

function cannedNpcOutput(ctx: NpcContext): unknown {
  // Directed demo replies echo the gist so the integration suite can assert steering worked.
  if (ctx.direction) {
    return {
      dialogue: `[directed] ${ctx.direction}`,
      tone: 'steady',
      disposition_delta: { value: 0, reason: 'demo directed' },
    }
  }
  const t = ctx.utterance.text.toLowerCase()
  const others = ctx.pcs.filter((p) => p.characterId !== ctx.utterance.actorCharacterId)
  const quietest = [...others].sort((a, b) => a.linesThisScene - b.linesThisScene)[0]
  const out: Record<string, unknown> = {
    dialogue: t.includes('secret')
      ? 'Fine - you leave me no choice. I will tell you everything I know.'
      : ctx.checkResult && !ctx.checkResult.success
        ? 'The shutters come down behind their eyes. "I have said enough."'
        : `You ask about "${ctx.utterance.text.slice(0, 40)}" - I may know something of that.`,
    tone: ctx.checkResult?.success === false ? 'guarded' : 'wary',
    disposition_delta: { value: /thank|compliment|friend/.test(t) ? 1 : /threat|or else/.test(t) ? -1 : 0, reason: 'demo' },
  }
  // Adversarial fixture: "secret" tries to dump the whole knowledge list, gated or not.
  if (t.includes('secret')) out.reveals = ctx.knowledge.map((k) => k.id)
  else if (ctx.checkResult?.success && ctx.knowledge.length > 0) out.reveals = [ctx.knowledge[0].id]
  if (ctx.checkResult?.success && ctx.checkResult.skill === 'insight') {
    out.opening = { unlocked_by: ctx.utterance.actorCharacterId, skill: 'persuasion' }
  }
  if (/everyone|all of you/.test(t) && quietest) out.address_pc = quietest.characterId
  if (/join us|come with us|fight with us/.test(t) && ctx.checkResult?.success) {
    out.proposed_actions = [{ type: 'join_combat' }]
  }
  return out
}

const NPC_SYSTEM =
  'You roleplay one NPC in a D&D-style game. Stay in character; 1-3 sentences of spoken dialogue. ' +
  'Reply with ONLY JSON: {"dialogue": string, "tone": string, "address_pc"?: character_id, ' +
  '"reveals"?: [ingredient_id], "opening"?: {"unlocked_by": character_id, "skill": string}, ' +
  '"disposition_delta": {"value": -2..2, "reason": string}, "proposed_actions"?: ' +
  '[{"type": "join_combat"|"leave"|"give_item"|"canonize_theory", "payload"?: object}]}. ' +
  'Only reveal knowledge whose condition is met by the check result. Openings only after a real ' +
  'insight success, unlocked_by = that roller, consumable by a DIFFERENT pc. Every 3-5 exchanges, ' +
  'address_pc someone who has spoken little - an invitation, never an interrogation of the idle.'

export async function runNpcAgent(env: AgentEnv, ctx: NpcContext): Promise<NpcAgentOutput> {
  const pcIds = ctx.pcs.map((p) => p.characterId)
  if (env.demo) {
    const parsed = parseNpcOutput(cannedNpcOutput(ctx), pcIds)
    if (!parsed.ok) throw new AgentCallError(parsed.errors.join('; '))
    return parsed.data
  }
  const user = [
    `NPC: ${ctx.npc.name} (${ctx.npc.faction}). Personality: ${ctx.npc.personality}. ${ctx.npc.description}`,
    `Disposition to each PC (-10..10): ${JSON.stringify(ctx.dispositionByPc)}`,
    `Interaction memory: ${ctx.memory.join(' | ') || 'first meeting'}`,
    `Knowledge (id: what it reveals [condition]): ${ctx.knowledge.map((k) => `${k.id}: ${k.reveals}${k.condition ? ` [requires: ${k.condition}]` : ''}`).join(' | ') || 'none'}`,
    `Already revealed this scene: ${ctx.conversation.revealedThisScene.join(', ') || 'nothing'}`,
    `PCs present (id, name, lines spoken this scene): ${ctx.pcs.map((p) => `${p.characterId} "${p.name}" ${p.linesThisScene}`).join('; ')}`,
    ctx.hooks.length > 0 ? `Work in naturally if the moment fits: ${ctx.hooks.join(' | ')}` : '',
    `${ctx.utterance.actorName} says: "${ctx.utterance.text}"`,
    ctx.checkResult
      ? `Their ${ctx.checkResult.skill} check ${ctx.checkResult.success ? 'SUCCEEDED' : 'FAILED'} (margin ${ctx.checkResult.margin}).`
      : 'No check involved - plain conversation.',
    ctx.direction ? `The DM chose this direction for your reply - follow it closely: "${ctx.direction}"` : '',
    ctx.constraint ? `HARD CONSTRAINTS - the previous draft violated these facts. ${ctx.constraint}` : '',
  ].filter(Boolean).join('\n')
  const parsed = parseNpcOutput(await agentJson(env, 'npc_agent', NPC_SYSTEM, user, 600), pcIds)
  if (!parsed.ok) throw new AgentCallError(`NPC output invalid: ${parsed.errors.join('; ')}`)
  return parsed.data
}

const GIST_SYSTEM =
  'You assist a human DM running an NPC in a D&D-style game. Propose exactly 3 distinct one-sentence ' +
  'directions ("gists") for how the NPC could respond - a direction, never the full spoken line. ' +
  'Make them meaningfully different (e.g. warm / guarded / deflecting). Each 15 words or fewer. ' +
  'Reply with ONLY JSON: {"gists": [string, string, string]}.'

/** Slice 2 stage 1: three cheap candidate directions for the DM console (F07 SS4 review gate). */
export async function runReplyGists(env: AgentEnv, ctx: NpcContext, rejected?: string[]): Promise<string[]> {
  if (env.demo) {
    const suffix = rejected && rejected.length > 0 ? ' (fresh take)' : ''
    return [
      `Answers ${ctx.utterance.actorName} honestly but briefly${suffix}`,
      `Deflects and changes the subject${suffix}`,
      `Turns the question back on the party${suffix}`,
    ]
  }
  const user = [
    `NPC: ${ctx.npc.name} (${ctx.npc.faction}). Personality: ${ctx.npc.personality}. ${ctx.npc.description}`,
    `Disposition to each PC (-10..10): ${JSON.stringify(ctx.dispositionByPc)}`,
    `Unrevealed knowledge the NPC holds: ${ctx.knowledge.map((k) => k.reveals).join(' | ') || 'none'}`,
    `${ctx.utterance.actorName} says: "${ctx.utterance.text}"`,
    ctx.checkResult
      ? `Their ${ctx.checkResult.skill} check ${ctx.checkResult.success ? 'SUCCEEDED' : 'FAILED'} (margin ${ctx.checkResult.margin}).`
      : 'No check involved - plain conversation.',
    rejected && rejected.length > 0
      ? `The DM rejected these directions - offer 3 genuinely different ones: ${rejected.join(' | ')}`
      : '',
  ].filter(Boolean).join('\n')
  return parseGists(await agentJson(env, 'npc_agent', GIST_SYSTEM, user, 200))
}

const NARRATOR_SYSTEM =
  'You narrate a tabletop RPG. Second person, present tense, 2-4 sentences, vivid but concise. ' +
  'Never invent facts about named NPCs/items/places beyond the given context. Output only narration text.'

export async function runNarrator(env: AgentEnv, prompt: string, constraint?: string): Promise<string> {
  if (env.demo) return `[demo narration] ${prompt.slice(0, 140)}`
  return await callAgentText({
    serviceClient: env.service,
    openRouterApiKey: OPENROUTER_API_KEY,
    userId: env.creatorId,
    adventureId: env.adventureId,
    agentRole: 'narrator',
    system: constraint ? `${NARRATOR_SYSTEM}\nHard constraints: ${constraint}` : NARRATOR_SYSTEM,
    user: prompt,
    maxTokens: 400,
  })
}

export async function runNarratorOptions(env: AgentEnv, contextPrompt: string): Promise<string[]> {
  if (env.demo) {
    return [
      'A stranger bursts into the room with news of the missing boy.',
      'The innkeeper quietly slides a folded note across the counter.',
      'Shouting erupts outside - torchlight gathers near the well.',
    ]
  }
  const raw = await agentJson(
    env,
    'narrator',
    'Offer 3-4 directions the story could go next. Reply with ONLY JSON: {"options": [{"summary": "one sentence"}]}.',
    contextPrompt,
    300,
  )
  return parseNarrationOptions(raw)
}

const CONSISTENCY_SYSTEM =
  'You fact-check a game narration draft against established facts. Reply with ONLY JSON: ' +
  '{"ok": boolean, "violations": [{"claim": string, "conflicts_with": string}]}. Tone and style ' +
  'are free - flag only factual contradictions (dead people acting, wrong locations, items nobody has).'

/** Deterministic pass first (F07 SS6.1); LLM pass only for non-demo (SS6.2). */
export async function runConsistency(
  env: AgentEnv,
  draft: string,
  npcs: { id: string; name: string }[],
  npcStates: Record<string, string>,
  factSheet: string,
): Promise<ConsistencyVerdict> {
  const violations: ConsistencyVerdict['violations'] = []
  for (const npc of npcs) {
    const state = npcStates[npc.id]
    if ((state === 'dead' || state === 'absent') && npc.name && draft.toLowerCase().includes(npc.name.toLowerCase())) {
      violations.push({ claim: `mentions ${npc.name}`, conflictsWith: `${npc.name} is ${state}` })
    }
  }
  if (violations.length > 0) return { ok: false, violations }
  if (env.demo) return { ok: true, violations: [] }
  try {
    return parseConsistency(
      await agentJson(env, 'consistency_checker', CONSISTENCY_SYSTEM, `Facts:\n${factSheet}\n\nDraft:\n${draft}`, 300),
    )
  } catch {
    return { ok: true, violations: [] } // checker outage must not block play; incidents log elsewhere
  }
}

export interface InteractionSummary {
  said: string[]
  promised: string[]
  revealed: string[]
  disposition_trajectory: string
}

/** Scene-end distillation (F10 SS6) - one interaction-memory entry per participating NPC. */
export async function runInteractionSummary(
  env: AgentEnv,
  npcName: string,
  transcript: string[],
  revealedIds: string[],
): Promise<InteractionSummary> {
  const fallback: InteractionSummary = {
    said: transcript.slice(-3),
    promised: [],
    revealed: revealedIds,
    disposition_trajectory: 'unchanged',
  }
  if (env.demo) return fallback
  try {
    const raw = await agentJson(
      env,
      'summarizer',
      'Distill one NPC\'s side of a roleplay scene for future recall. Reply with ONLY JSON: ' +
        '{"said": string[], "promised": string[], "revealed": string[], "disposition_trajectory": string}.',
      `NPC: ${npcName}\nTranscript:\n${transcript.join('\n')}\nRevealed ingredient ids: ${revealedIds.join(', ') || 'none'}`,
      400,
    )
    const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const arr = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
    return {
      said: arr(obj.said),
      promised: arr(obj.promised),
      revealed: arr(obj.revealed).length > 0 ? arr(obj.revealed) : revealedIds,
      disposition_trajectory: typeof obj.disposition_trajectory === 'string' ? obj.disposition_trajectory : 'unchanged',
    }
  } catch {
    return fallback
  }
}

export interface GenericNpcSeed {
  name: string
  personality: string
  dispositionDefault: number
}

export async function runGenericNpc(env: AgentEnv, roleHint: string, locationName: string): Promise<GenericNpcSeed> {
  if (env.demo) return { name: `The ${roleHint || 'stranger'}`, personality: 'brisk, practical', dispositionDefault: 0 }
  try {
    const raw = await agentJson(
      env,
      'npc_agent',
      'Invent a lightweight background NPC. Reply with ONLY JSON: {"name": string, "one_line_personality": string, "disposition_default": -2..2}.',
      `Role: ${roleHint}. Location: ${locationName}.`,
      150,
    )
    const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    return {
      name: typeof obj.name === 'string' && obj.name ? obj.name : `The ${roleHint || 'stranger'}`,
      personality: typeof obj.one_line_personality === 'string' ? obj.one_line_personality : 'unremarkable',
      dispositionDefault: Math.max(-2, Math.min(2, Number(obj.disposition_default) || 0)),
    }
  } catch {
    return { name: `The ${roleHint || 'stranger'}`, personality: 'unremarkable', dispositionDefault: 0 }
  }
}
