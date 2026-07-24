// Phase 5 agent calls (Adjudicator F07 SS3.3, social classifier + NPC Agent F10 SS3,
// Narrator, Consistency Checker F07 SS6). Demo adventures (demo=true) return canned,
// pattern-keyed outputs so the scripted walkthrough and the integration suite spend nothing -
// including deliberately adversarial fixtures (over-reveal, dead-NPC narration) that exercise
// the server-side guardrails.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { AgentCallError, callAgentText, callAgentTextWithMeta } from '../_shared/llm.ts'
import {
  CLAIM_ROLES, claimViolations, decideCanonization, extractJson, parseAdjudication,
  parseConsistency, parseEntityClaims, parseGists, parseGrounding, parseNarrationOptions,
  parseNpcOutput, parseSocialClassification, suspectEntities,
} from '../_shared/play/index.ts'
import type {
  AdjudicationOutput, ClaimEntity, ClaimViolation, ConsistencyVerdict, GroundingDecision,
  NpcAgentOutput, PlayerLine, SocialClassification,
} from '../_shared/play/index.ts'
import { parseOfferResponse } from '../_shared/story/index.ts'
import type { OfferResponseKind } from '../_shared/story/index.ts'
import { logEvent } from './util.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''

export interface AgentEnv {
  service: SupabaseClient
  adventureId: string
  creatorId: string
  demo: boolean
  /** Adventure mode - the Slice 2 review gate only ever engages for 'assist'. */
  mode: 'full_ai' | 'assist' | null
}

export async function agentJson(
  env: AgentEnv,
  role: string,
  system: string,
  user: string,
  maxTokens: number,
  schema?: { name: string; schema: Record<string, unknown> },
): Promise<unknown> {
  const call = (tokens: number) => callAgentTextWithMeta({
    serviceClient: env.service,
    openRouterApiKey: OPENROUTER_API_KEY,
    userId: env.creatorId,
    adventureId: env.adventureId,
    agentRole: role,
    system,
    user,
    maxTokens: tokens,
    schema,
  })

  let result = await call(maxTokens)
  let parsed = extractJson(result.text)
  // Retry on the PARSE, not on provider metadata. Every unparseable reply observed live was
  // truncated JSON - '{\n  "interpretation":' at 21 chars, '{"' at 2 - yet llm.ts's retry keys
  // off finish_reason === 'length', which this provider does not reliably report when the
  // budget went to reasoning tokens instead of content. The parse failing is the symptom we
  // actually care about and the one signal that is always available.
  if (parsed === null || typeof parsed !== 'object') {
    // TWO different failures wear the same face here, and until now both got the same medicine.
    //
    //   TRUNCATION - the model was still writing when the budget ran out. More tokens help.
    //   PROVIDER ERROR - finish_reason 'error' with completion_tokens 0. The call died upstream
    //                    and produced nothing. More tokens are irrelevant; it needs another try.
    //
    // Live 2026-07-23, the 100-turn heist: 3 of 75 turns returned HTTP 500 to the player, every
    // one an adjudicator call with finish_reason 'error' and 0 completion tokens. Doubling the
    // cap on a dead call just bought a second dead call, and the player lost their turn. This
    // file's own comment already suspected the truncation theory was wrong - the finish_reason
    // was sitting right there in the logs, unread by the retry.
    const providerFailed = result.finishReason === 'error' || result.completionTokens === 0
    result = await call(providerFailed ? maxTokens : maxTokens * 2)
    parsed = extractJson(result.text)
    // A provider error is transient by nature; one more plain attempt is far cheaper than
    // charging a player for a failure that had nothing to do with them.
    if ((parsed === null || typeof parsed !== 'object') && providerFailed) {
      result = await call(maxTokens)
      parsed = extractJson(result.text)
    }
  }
  // Every parse failure so far has been diagnosed by guesswork, because the text that failed is
  // discarded here and the caller only ever reports "not an object". Raising the token cap on a
  // truncation theory did not stop the adjudicator 500s (live 2026-07-21), so keep the evidence:
  // whether this is prose, a fragment, or a valid non-object is the whole question. completion_tokens
  // vs the cap that produced this reply settles WHY - at the cap the budget cut it off, well short
  // means the model stopped on its own and no cap will help. Threaded off the failing call itself
  // so the harness reads it directly instead of re-joining usage_log by role (2026-07-22).
  if (parsed === null || typeof parsed !== 'object') {
    await logEvent(env.service, env.adventureId, null, 'agent_output_unparsed', {
      role,
      chars: result.text.length,
      head: result.text.slice(0, 300),
      tail: result.text.length > 300 ? result.text.slice(-120) : '',
      completion_tokens: result.completionTokens,
      finish_reason: result.finishReason,
      cap: result.maxTokens,
    }).catch(() => {})
  }
  return parsed
}

/** Shorthand for the JSON Schema shapes below - every property is required under `strict`. */
const obj = (properties: Record<string, unknown>, required?: string[]) => ({
  type: 'object',
  properties,
  required: required ?? Object.keys(properties),
  additionalProperties: false,
})
const str = { type: 'string' }
const strArray = { type: 'array', items: { type: 'string' } }

/** The narrator's option list - a wrong shape here 502'd narrate_next (live 2026-07-21). */
export const NARRATION_OPTIONS_SCHEMA = {
  name: 'narration_options',
  schema: obj({
    options: { type: 'array', items: obj({ summary: str }), minItems: 3, maxItems: 4 },
  }),
}

/** The consistency verdict. */
export const CONSISTENCY_SCHEMA = {
  name: 'consistency_verdict',
  schema: obj({
    ok: { type: 'boolean' },
    violations: { type: 'array', items: obj({ claim: str, conflicts_with: str }) },
  }),
}

/**
 * Consistency schema bound to the scene's actual restrictions. `restriction_id` is an ENUM of
 * canon restriction ids, so a violation the canon does not support cannot be expressed - the
 * fix for a free-text `conflicts_with` that let the model invent grounds and block real prose
 * (live 2026-07-23: "Elias Thorne is not in the party" silenced the narrator 10 times).
 * `claim` must be quoted from the draft; the parser verifies that too.
 */
function consistencySchemaFor(restrictionIds: string[]) {
  return {
    name: 'consistency_verdict',
    schema: obj({
      ok: { type: 'boolean' },
      violations: {
        type: 'array',
        items: obj({
          claim: { type: 'string', description: 'The exact sentence from the draft, quoted verbatim.' },
          restriction_id: { type: 'string', enum: restrictionIds },
          conflicts_with: str,
        }),
      },
    }),
  }
}

/**
 * Prose claim extraction (2026-07-23). The model PERCEIVES - it reports how a passage depicts
 * people it is handed - and code alone decides whether that is a contradiction (play/claims.ts).
 *
 * Deliberately never asks "is this consistent?". That question produced 14 false positives in 14
 * blocks across three paid runs, because a model handed a fact fragment cannot tell what would
 * negate it. "Does this passage give Elias Thorne a line?" is answerable.
 */
const CLAIM_EXTRACTOR_SYSTEM =
  'You read one passage from a tabletop RPG scene and report how it depicts specific named ' +
  'people. You are NOT judging quality, correctness or consistency - only what the passage ' +
  'SHOWS. For each person listed, choose exactly one role. ' +
  '"speaks": they say words here - dialogue, a whisper, a shout, a reply. ' +
  '"acts": they physically do something here and now - move, strike, hand something over, ' +
  'flinch, lead the way. ' +
  '"mentioned": EVERYTHING else. They are named, described, remembered, mourned, feared, ' +
  'discussed or blamed; their corpse, their belongings or their handiwork are described; ' +
  'someone else speaks about them; their past deeds are recalled; they are quoted from memory. ' +
  'A dead body being described is "mentioned", never "acts". A name inside someone else\'s ' +
  'sentence is "mentioned", never "speaks". If you are unsure, answer "mentioned". ' +
  'Report only the people listed; ignore everyone else in the passage.'

function claimSchemaFor(names: string[]) {
  return {
    name: 'entity_claims',
    schema: obj({
      claims: {
        type: 'array',
        items: obj({
          name: { type: 'string', enum: names },
          role: { type: 'string', enum: [...CLAIM_ROLES] },
        }),
      },
    }),
  }
}

/**
 * Does this draft put words in a dead mouth, or move someone who is not here?
 *
 * Costs nothing in the ordinary case: only a dead or absent person NAMED in the draft can
 * produce a violation, so `suspectEntities` skips the model call entirely in any scene where
 * nobody relevant is gone - which in a healthy run is nearly every scene.
 */
export async function runClaimCheck(
  env: AgentEnv,
  draft: string,
  roster: readonly ClaimEntity[],
): Promise<{ violations: ClaimViolation[]; checked: string[] }> {
  const suspects = suspectEntities(draft, roster)
  if (suspects.length === 0 || env.demo) return { violations: [], checked: [] }
  const checked = suspects.map((s) => s.name)
  try {
    const raw = await agentJson(
      env, 'consistency_checker', CLAIM_EXTRACTOR_SYSTEM,
      `People to report on: ${checked.join(', ')}\n\nPassage:\n${draft}`,
      300, claimSchemaFor(checked),
    )
    // Judged against the SUSPECTS only: a living name the extractor volunteered cannot violate.
    return { violations: claimViolations(parseEntityClaims(raw), suspects), checked }
  } catch {
    return { violations: [], checked: [] } // a checker outage must never silence the narrator
  }
}

/**
 * Theory grounding: which of the party's own lines asserts this claim, if any?
 *
 * Not "is this consistent?" - the question canonization used to ask, which cannot fail. This one
 * has a closed answer set (the lines the party actually spoke) and a safe default (none).
 */
const GROUNDING_SYSTEM =
  'A game engine is about to make a statement PERMANENTLY TRUE in a shared story world, but only ' +
  'if one of the players actually proposed it. You are given the statement and a numbered list of ' +
  'lines the players said in this scene. Reply with the index of the ONE line in which a player ' +
  'asserts, proposes, guesses or speculates that statement - including phrasings like "I think", ' +
  '"maybe", "what if", "I bet". Asking a QUESTION about the topic is not asserting it. A line ' +
  'that merely mentions the same people or place is not asserting it. If no line asserts the ' +
  'statement, use -1. When in doubt, use -1. ' +
  // State the shape, as every other agent in this file does. Without it the model answered with
  // the bare scalar `-1`, which is not an object, so agentJson logged agent_output_unparsed
  // twice in one run and the gate only refused by falling through its own catch (live
  // 2026-07-23). Refusing for the right reason and refusing because the parse died look
  // identical in the log, which is exactly the kind of blindness worth spending a line on.
  'Reply with ONLY JSON in this exact shape: {"line_index": <number>}'

function groundingSchemaFor(menuSize: number) {
  return {
    name: 'theory_grounding',
    schema: obj({
      line_index: {
        type: 'integer',
        enum: [-1, ...Array.from({ length: menuSize }, (_, i) => i)],
        description: 'Index of the player line asserting the statement, or -1 for none.',
      },
    }),
  }
}

export async function runTheoryGrounding(
  env: AgentEnv,
  theory: string,
  menu: readonly PlayerLine[],
): Promise<GroundingDecision> {
  if (menu.length === 0) return decideCanonization(menu, { lineIndex: null })
  // Demo fixtures assert the canonization path end to end; their theory IS the player's line.
  if (env.demo) return decideCanonization(menu, { lineIndex: menu.length - 1 })
  try {
    const raw = await agentJson(
      env, 'consistency_checker', GROUNDING_SYSTEM,
      `Statement: ${theory}\n\nPlayer lines:\n${menu.map((l) => `[${l.index}] ${l.speaker}: ${l.text}`).join('\n')}`,
      120, groundingSchemaFor(menu.length),
    )
    return decideCanonization(menu, parseGrounding(raw, menu.length))
  } catch {
    // Refuse on outage: a missed theory is recoverable, a wrongly-granted one is not.
    return decideCanonization(menu, { lineIndex: null })
  }
}

/** Utterance routing inside a conversation. */
export const CLASSIFICATION_SCHEMA = {
  name: 'social_classification',
  schema: obj({
    kind: { type: 'string', enum: ['conversation', 'insight', 'influence', 'action', 'ask_dm'] },
    skill: { type: 'string', enum: ['persuasion', 'deception', 'intimidation', 'insight', ''] },
    magnitude: { type: 'string', enum: ['trivial', 'reasonable', 'costly', 'against_nature', ''] },
  }),
}

export interface AdjudicatorContext {
  intentText: string
  actorSummary: string
  sceneSummary: string
  objective: { title: string; hiddenDescription: string } | null
  partySkills: string[]
  partySize: number
  recentEvents: string[]
  /** Registry names the scene_effects proposal may reference (Story Director v1). */
  knownLocations: string[]
  knownNpcs: string[]
  /** Authored milestone vocabulary (objective + open-beat predicate atoms, exact text). */
  milestones: string[]
}

/** World-movement proposal riding on the Adjudicator's ruling; server-validated before applying. */
export interface SceneEffects {
  travelLocation: string | null
  stageNpcs: string[]
  markEvent: string | null
  advanceDay: boolean
  /** Combat encounter label; pre-Phase 7 this auto-resolves as a placeholder party victory. */
  encounter: string | null
  /** Authored milestones this action accomplished; server-validated against the vocabulary. */
  milestones: string[]
  /** The conversation/scene concluded - staged NPCs step down (also implied by travel). */
  endScene: boolean
  /** The action makes serious noise - raises danger and may draw a random encounter (Slice 6). */
  loud: boolean
}

function extractSceneEffects(raw: unknown): SceneEffects | null {
  if (typeof raw !== 'object' || raw === null) return null
  const effects = (raw as Record<string, unknown>).scene_effects
  if (typeof effects !== 'object' || effects === null) return null
  const obj = effects as Record<string, unknown>
  const travel = typeof obj.travel_location === 'string' && obj.travel_location.trim() ? obj.travel_location.trim() : null
  const npcs = Array.isArray(obj.stage_npcs)
    ? obj.stage_npcs.filter((n): n is string => typeof n === 'string' && n.trim().length > 0).map((n) => n.trim()).slice(0, 3)
    : []
  const markEvent = typeof obj.mark_event === 'string' && obj.mark_event.trim() ? obj.mark_event.trim().slice(0, 120) : null
  const advanceDay = obj.advance_day === true
  let encounter: string | null = null
  if (typeof obj.encounter === 'object' && obj.encounter !== null) {
    const enc = obj.encounter as Record<string, unknown>
    if (enc.kind === 'combat') {
      encounter = typeof enc.label === 'string' && enc.label.trim() ? enc.label.trim().slice(0, 80) : 'combat'
    }
  }
  const milestones = Array.isArray(obj.milestones)
    ? obj.milestones.filter((m): m is string => typeof m === 'string' && m.trim().length > 0).map((m) => m.trim()).slice(0, 3)
    : []
  const endScene = obj.end_scene === true
  const loud = obj.loud === true
  if (!travel && npcs.length === 0 && !markEvent && !advanceDay && !encounter && milestones.length === 0 && !endScene && !loud) return null
  return { travelLocation: travel, stageNpcs: npcs, markEvent, advanceDay, encounter, milestones, endScene, loud }
}

function cannedAdjudication(text: string, partySkills: string[]): AdjudicationOutput {
  const t = text.toLowerCase()
  const base = { interpretation: `[demo] ${text}`, flags: { impossible: false, needsDm: false, talk: false } }
  const check = (spec: Record<string, unknown>) =>
    parseAdjudication(
      { ...base, resolution: { type: 'check', check: spec, consequences_hint: 'demo consequences' } },
      partySkills,
    )
  if (t.includes('impossible')) {
    return { ...base, flags: { impossible: true, needsDm: false, talk: false }, resolution: { type: 'auto_fail', check: null, consequencesHint: 'cannot be done' } }
  }
  if (/\?\s*$/.test(text)) {
    return { ...base, flags: { impossible: false, needsDm: false, talk: true }, resolution: { type: 'auto_success', check: null, consequencesHint: 'a question for the DM' } }
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
    const out = check({
      skill: 'investigation', skill_options: ['perception'], dc: 12, adv_dis: 'none', rationale: 'hidden detail',
    })
    if (out.ok) return out.data
  }
  return { ...base, resolution: { type: 'auto_success', check: null, consequencesHint: 'it simply works' } }
}

const ADJUDICATOR_SYSTEM =
  'You adjudicate free-text player actions in a D&D 5e-style game. ' +
  // The reply shape is guaranteed by a json_schema, so spelling it out here bought nothing and
  // cost ~200 tokens of every call - while ALSO contradicting it: the old spec marked fields
  // "?: optional" when strict mode requires every key. Truncated replies were the result of an
  // over-long answer, so the budget belongs in the ruling, not in restating the format.
  'BREVITY IS REQUIRED - the reply is cut off if you overrun. interpretation: at most 15 words, ' +
  'one clause on what the player is attempting. rationale: at most 12 words. ' +
  'consequences_hint: at most 12 words. Never pad, never restate the action, never explain your ' +
  'reasoning beyond those limits. Fields you have nothing to say for take null or false. ' +
  'Trivial actions auto-succeed - never demand rolls for everything; unopposed travel between ' +
  'known locations ALWAYS auto-succeeds. Use "group": true for whole-party actions. Only spec ' +
  'requires_assist with a skill from the party skill list. Add scene_effects when the action ' +
  'moves the party to a known location (travel_location), draws named NPCs into conversation ' +
  '(stage_npcs), or completes a notable story moment (mark_event: short past-tense marker). ' +
  'Use ONLY names from the provided location/NPC lists; omit scene_effects when nothing changes. ' +
  'When the party seeks out or addresses a named NPC, prefer stage_npcs so the conversation goes live. ' +
  'Set advance_day true only when meaningful in-game time passes (a long journey, a rest, waiting out a tide). ' +
  'COMBAT: when the party initiates a fight or foes engage them (an attack, an ambush, weapons drawn ' +
  'on both sides), set resolution type "auto_success" AND scene_effects.encounter ' +
  '{"kind": "combat", "label": short battle name}. Never spec a skill check for fighting itself - ' +
  'checks are for avoiding, escaping, or setting up a fight, not resolving one. ' +
  'MILESTONES: when this action (with its outcome) genuinely accomplishes one of the authored ' +
  'milestones in the provided list, put that milestone in scene_effects.milestones copying its ' +
  'EXACT text. Never invent milestones and never claim one that has not clearly happened yet. ' +
  'Set end_scene true when the party disengages from, concludes, or walks away from the current conversation. ' +
  'Set loud true when the action makes serious noise or draws attention (smashing, explosions, shouting matches, alarms). ' +
  'SKILL OPTIONS: like a table DM ("Does my Investigation apply?" "Sure!"), when more than one ' +
  'skill could reasonably serve the attempt, list the alternatives in skill_options (most apt ' +
  'first is "skill") - the player picks which to roll. ' +
  'CHARACTER: weigh the actor\'s species traits, background, and quirks in every ruling. A ' +
  'trait that trivializes the action (Darkvision when peering into darkness) means ' +
  'auto_success or advantage with a lower DC; a hindering trait means disadvantage or a ' +
  'higher DC. Name the deciding trait in the rationale so the player sees why. ' +
  'TALK: set flags.talk true (resolution auto_success) ONLY for table talk or questions ' +
  'answerable from plain sight and common knowledge - the DM just answers those. A question ' +
  'that probes for HIDDEN or uncertain information ("any hint the gargoyles are creatures, ' +
  'not decorations?") is an attempt: spec a check for it instead.'

/**
 * The Adjudicator's world-effects, with every reference field enum'd to what actually exists.
 *
 * These are the three the server has been silently dropping: travel_location misses matchByName
 * and logs scene_effect_rejected (travel fired 0-3 times across every run, which is why location
 * clues kept being unreachable), stage_npcs names people who are not in the registry, and
 * milestones get discarded by applyMilestones for paraphrasing. Each one is a set we are already
 * holding - so hand it to the model as a closed choice instead of hoping it copies correctly.
 */
function sceneEffectsSchema(ctx: AdjudicatorContext): { name: string; schema: Record<string, unknown> } {
  const enumOrString = (values: string[]) =>
    values.length > 0 ? { type: 'string', enum: values } : { type: 'string' }
  const skills = ctx.partySkills.length > 0 ? ctx.partySkills : ['']
  return {
    name: 'adjudication',
    schema: {
      type: 'object',
      additionalProperties: false,
      required: ['interpretation', 'resolution', 'flags', 'scene_effects'],
      properties: {
        // maxLength on every prose field: the schema is the thing the provider enforces, and
        // these three are the only unbounded text in the hottest call in the app.
        interpretation: { type: 'string', maxLength: 120 },
        resolution: {
          type: 'object',
          additionalProperties: false,
          required: ['type', 'check', 'consequences_hint'],
          properties: {
            type: { type: 'string', enum: ['auto_success', 'auto_fail', 'check'] },
            check: {
              type: ['object', 'null'],
              additionalProperties: false,
              required: ['skill', 'skill_options', 'dc', 'adv_dis', 'rationale', 'group', 'requires_assist'],
              properties: {
                skill: { type: 'string', enum: skills },
                skill_options: { type: 'array', items: { type: 'string', enum: skills }, maxItems: 3 },
                dc: { type: 'integer', minimum: 5, maximum: 25 },
                adv_dis: { type: 'string', enum: ['none', 'advantage', 'disadvantage'] },
                rationale: { type: 'string', maxLength: 100 },
                group: { type: 'boolean' },
                requires_assist: {
                  type: ['object', 'null'],
                  additionalProperties: false,
                  required: ['skill', 'effect'],
                  properties: {
                    skill: { type: 'string', enum: skills },
                    effect: { type: 'string', enum: ['enable', 'bonus'] },
                  },
                },
              },
            },
            consequences_hint: { type: 'string', maxLength: 100 },
          },
        },
        flags: {
          type: 'object',
          additionalProperties: false,
          required: ['impossible', 'needs_dm', 'talk'],
          properties: {
            impossible: { type: 'boolean' },
            needs_dm: { type: 'boolean' },
            talk: { type: 'boolean' },
          },
        },
        scene_effects: {
          type: ['object', 'null'],
          additionalProperties: false,
          required: [
            'travel_location', 'stage_npcs', 'mark_event', 'advance_day', 'encounter',
            'milestones', 'end_scene', 'loud',
          ],
          properties: {
            travel_location: {
              anyOf: [enumOrString(ctx.knownLocations), { type: 'null' }],
            },
            stage_npcs: { type: 'array', items: enumOrString(ctx.knownNpcs), maxItems: 3 },
            mark_event: { type: ['string', 'null'] },
            advance_day: { type: 'boolean' },
            encounter: {
              type: ['object', 'null'],
              additionalProperties: false,
              required: ['kind', 'label'],
              properties: { kind: { type: 'string', enum: ['combat'] }, label: { type: 'string' } },
            },
            milestones: { type: 'array', items: enumOrString(ctx.milestones), maxItems: 3 },
            end_scene: { type: 'boolean' },
            loud: { type: 'boolean' },
          },
        },
      },
    },
  }
}

export async function runAdjudicator(
  env: AgentEnv,
  ctx: AdjudicatorContext,
): Promise<AdjudicationOutput & { sceneEffects: SceneEffects | null }> {
  if (env.demo) return { ...cannedAdjudication(ctx.intentText, ctx.partySkills), sceneEffects: null }
  const user = [
    `Action: ${ctx.intentText}`,
    `Actor: ${ctx.actorSummary}`,
    `Scene: ${ctx.sceneSummary}`,
    ctx.objective ? `Current objective: ${ctx.objective.title} (DM notes: ${ctx.objective.hiddenDescription})` : '',
    `Party size: ${ctx.partySize}; party skills: ${ctx.partySkills.join(', ')}`,
    `Known locations: ${ctx.knownLocations.join('; ') || 'none listed'}`,
    `Named NPCs in the world: ${ctx.knownNpcs.join('; ') || 'none listed'}`,
    `Authored milestones (exact text): ${ctx.milestones.join(' | ') || 'none'}`,
    `Recent events: ${ctx.recentEvents.join(' | ') || 'none'}`,
  ].filter(Boolean).join('\n')
  // 600 was set when this returned prose with optional fields omitted; strict mode makes every
  // key mandatory, nulls included, and the tail of the object is where scene_effects lives.
  // max_tokens is a cap, not a spend - raising it costs nothing on replies that stay short.
  const raw = await agentJson(env, 'adjudicator', ADJUDICATOR_SYSTEM, user, 1000, sceneEffectsSchema(ctx))
  const parsed = parseAdjudication(raw, ctx.partySkills)
  if (!parsed.ok) throw new AgentCallError(`Adjudicator output invalid: ${parsed.errors.join('; ')}`)
  return { ...parsed.data, sceneEffects: extractSceneEffects(raw) }
}

function cannedClassification(text: string): SocialClassification {
  const t = text.toLowerCase()
  if (/(convince|persuade|please|beg|let us)/.test(t)) return { kind: 'influence', skill: 'persuasion', magnitude: 'reasonable' }
  if (/(lie|swear|pretend|totally)/.test(t)) return { kind: 'influence', skill: 'deception', magnitude: 'costly' }
  if (/(threat|or else|last chance)/.test(t)) return { kind: 'influence', skill: 'intimidation', magnitude: 'costly' }
  if (/(read|sense|study|size up)/.test(t)) return { kind: 'insight', skill: 'insight' }
  // Canned fixture only - the real classifier judges this. Kept so the $0 suites can assert
  // that a physical action mid-conversation escapes the NPC pipeline.
  if (/^(i|we) (all )?(draw|attack|climb|leap|vault|run|sneak|grab|push|pull|throw|smash|force|brace|search|examine)\b/.test(t)) {
    return { kind: 'action' }
  }
  return { kind: 'conversation' }
}

const CLASSIFIER_SYSTEM =
  'Classify a player utterance during a conversation with an NPC. Reply with ONLY JSON: ' +
  '{"kind": "conversation"} for plain talk, ' +
  '{"kind": "insight"} when they probe what the NPC hides/feels, {"kind": "influence", ' +
  '"skill": "persuasion"|"deception"|"intimidation", "magnitude": "trivial"|"reasonable"|"costly"|"against_nature"} ' +
  'when they push the NPC to act/agree, {"kind": "action"} when the input is primarily a ' +
  'PHYSICAL action or maneuver rather than something spoken (drawing steel, climbing away, ' +
  'searching the room), or {"kind": "ask_dm"} when they are asking about PHYSICAL DETAIL OF ' +
  'THE SURROUNDINGS that no person is being asked for - reading something in front of them, ' +
  'what else is in the room. Magnitude = how big the ask is for THIS npc.\n' +
  'Most talk is plain conversation. Decide ask_dm vs conversation by ONE test: could this NPC ' +
  'answer it from what they know? If yes it is conversation, even when phrased as a question ' +
  'about the world - "what happened to the keeper?" is asking THEM, not the DM.'

export async function runSocialClassifier(env: AgentEnv, utterance: string, npcSummary: string): Promise<SocialClassification> {
  if (env.demo) return cannedClassification(utterance)
  try {
    return parseSocialClassification(
      await agentJson(env, 'adjudicator', CLASSIFIER_SYSTEM, `NPC: ${npcSummary}\nUtterance: ${utterance}`, 120, CLASSIFICATION_SCHEMA),
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
  /** The scene's transcript so far - without it the NPC forgets what happened two lines ago
   *  (the orb handed over and immediately denied, playtest 2026-07-20). */
  recentLines: string[]
  utterance: { actorCharacterId: string; actorName: string; text: string }
  checkResult: { skill: string; success: boolean; margin: number } | null
  pcs: { characterId: string; name: string; linesThisScene: number }[]
  /** One personalization line per PC (species traits, background, quirks). */
  partyProfiles: string[]
  hooks: string[]
  /** Open beat goals (F08): situations the scene wants resolved - the NPC steers toward them. */
  beatGoals: string[]
  /**
   * The concrete terms on the table, when this NPC is the one who can speak to them. The code
   * has always known the number - `offer_staged {"gold": 75}` - and never told the speaker, so
   * the NPC hedged ("substantial", "a hefty purse") while the party asked "what's the pay",
   * "how much coin", "Specify an amount" across four consecutive turns (live 2026-07-23). A
   * quest-giver who cannot quote their own price cannot be negotiated with.
   */
  offerTerms: { label: string; gold: number; stakes: string; accepted: boolean }[]
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
  // F08 SS5 fixture: a stated theory makes the canned NPC propose canonization.
  if (t.includes('theory')) out.proposed_actions = [{ type: 'canonize_theory', payload: { theory: ctx.utterance.text } }]
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
  'address_pc someone who has spoken little - an invitation, never an interrogation of the idle. ' +
  'Unless the moment truly calls for silence, END your reply handing the scene back to the party - ' +
  'a question, a request, a proposal, an expectation - so they always know a response is wanted; ' +
  'never trail off on a bare statement. When the conversation has clearly concluded (farewells said, ' +
  'business done, the party moving on), include proposed_actions [{"type": "leave"}] so the scene can end.'

/**
 * The NPC reply, with `reveals` bound to the ids this NPC actually holds.
 *
 * It had no schema at all, so `reveals` was free text - and the model answered with short
 * paraphrases of its own knowledge rather than ids: "Murkheart uses psychological torment"
 * against our "The Murkheart uses the valley's elements to disorient and instill fear". The
 * reveal gate correctly refused every one as an unknown ingredient, so the clue never landed,
 * the atom was never awarded, and the objective was eventually retired for no progress.
 *
 * Live 2026-07-23/24: `reveal_blocked {reason: "unknown ingredient"}` appears in every paid run
 * (1-11 per run) and was fatal in The Cartographer's Debt - 11 refusals, 0 milestones in 30
 * turns, fail-forward on an objective the party was actively working. Matching the paraphrase
 * back to the clue is exactly the fuzzy-meaning matching that is banned here; making the id an
 * ENUM means free text cannot be expressed in the first place.
 *
 * `address_pc` and `opening.unlocked_by` get the same treatment - they are character ids from a
 * closed set, and parseNpcOutput already discards anything else, silently.
 */
function npcSchemaFor(knowledgeIds: string[], pcIds: string[]) {
  const idEnum = (values: string[]) =>
    values.length > 0 ? { type: 'string', enum: values } : { type: 'string' }
  return {
    name: 'npc_reply',
    schema: obj({
      dialogue: { type: 'string', description: '1-3 sentences of spoken dialogue, in character.' },
      tone: str,
      address_pc: idEnum(pcIds),
      reveals: {
        type: 'array',
        items: idEnum(knowledgeIds),
        description: knowledgeIds.length > 0
          ? 'Ids of knowledge to reveal now - copy an id exactly, never a description of it.'
          : 'This NPC holds no unrevealed knowledge; leave empty.',
      },
      opening: obj({ unlocked_by: idEnum(pcIds), skill: str }),
      disposition_delta: obj({ value: { type: 'integer' }, reason: str }),
      proposed_actions: {
        type: 'array',
        items: obj({
          type: { type: 'string', enum: ['join_combat', 'leave', 'give_item', 'canonize_theory'] },
          payload: { type: 'object' },
        }),
      },
    }, ['dialogue']),
  }
}

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
    ctx.partyProfiles.length > 0
      ? `Who these people are (react to their traits and quirks personally):\n${ctx.partyProfiles.map((p) => `- ${p}`).join('\n')}`
      : '',
    ctx.hooks.length > 0 ? `Work in naturally if the moment fits: ${ctx.hooks.join(' | ')}` : '',
    ctx.beatGoals.length > 0
      ? `Open story situations this scene wants resolved - steer the conversation toward them when natural, never force: ${ctx.beatGoals.join(' | ')}`
      : '',
    ctx.offerTerms.length > 0
      ? `TERMS ON THE TABLE - these numbers are settled fact, not yours to invent or round. If ` +
        `anyone asks what the job pays, SAY THE NUMBER; never answer with "substantial", "a ` +
        `hefty purse" or any other hedge:\n${ctx.offerTerms.map((o) =>
          `- ${o.label}: ${o.gold} gold${o.accepted ? ' (already agreed)' : ' (offered, not yet answered)'}` +
          `${o.stakes ? ` - at stake: ${o.stakes}` : ''}`).join('\n')}`
      : '',
    ctx.recentLines.length > 0
      ? `THIS SCENE SO FAR (everything here already happened - never contradict or forget it):\n${ctx.recentLines.join('\n')}`
      : '',
    `${ctx.utterance.actorName} says: "${ctx.utterance.text}"`,
    ctx.checkResult
      ? `Their ${ctx.checkResult.skill} check ${ctx.checkResult.success ? 'SUCCEEDED' : 'FAILED'} (margin ${ctx.checkResult.margin}).`
      : 'No check involved - plain conversation.',
    ctx.direction ? `The DM chose this direction for your reply - follow it closely: "${ctx.direction}"` : '',
    ctx.constraint ? `HARD CONSTRAINTS - the previous draft violated these facts. ${ctx.constraint}` : '',
  ].filter(Boolean).join('\n')
  const attempt = async () => {
    const parsed = parseNpcOutput(
      await agentJson(env, 'npc_agent', NPC_SYSTEM, user, 600,
        npcSchemaFor(ctx.knowledge.map((k) => k.id), pcIds)),
      pcIds,
    )
    if (!parsed.ok) throw new AgentCallError(`NPC output invalid: ${parsed.errors.join('; ')}`)
    return parsed.data
  }
  // The npc_agent default model fails intermittently on structured output (empty or malformed
  // JSON, seen live) - one fresh attempt recovers most of these before the player sees a 500.
  try {
    return await attempt()
  } catch {
    return await attempt()
  }
}

// --- Entry mapping (encounter-states 4.1): the cutscene phase's single handler -----------------

export type EntryKind = 'offered' | 'adhoc' | 'fold_in'

export interface EntryMapping {
  entry: EntryKind
  interpretation: string
  /** Scene movement riding on the reply (travel/staging/time) - validated server-side. */
  sceneEffects: SceneEffects | null
}

const ENTRY_SYSTEM =
  'A tabletop RPG is in a CUTSCENE: the narrator just delivered a hook toward the next ' +
  'encounter. Classify the party\'s reply. Reply with ONLY JSON: {"entry": ' +
  '"offered"|"adhoc"|"fold_in", "interpretation": string, "scene_effects"?: ' +
  '{"travel_location"?: string, "stage_npcs"?: [1-3 names], "advance_day"?: boolean}}. ' +
  '"offered": the reply engages or MOVES TOWARD the offered encounter in any way - attempting ' +
  'it, approaching its site, walking/climbing/riding onward, picking a direction the hook laid ' +
  'out, or agreeing to face it. Committing to move IS engagement ("I walk forward", "I follow ' +
  'the waterfall" - the story must go somewhere with it). "adhoc": the reply is a REAL ' +
  'endeavor with effort and risk pointed somewhere ELSE than the offered encounter (players ' +
  'going off-script deserve structure, not silence). "fold_in": ONLY talk and color that ' +
  'changes nothing about where the party stands - banter, questions, checking gear. If the ' +
  'reply repeats or continues something already folded in, the party is committing: map it ' +
  'offered (or adhoc), NEVER fold the same push twice - that reads as the story circling. ' +
  'Use scene_effects only for movement to a KNOWN listed location, drawing LISTED NPCs into ' +
  'conversation, or meaningful time passing. When unsure between offered and fold_in, prefer ' +
  'offered; when unsure between adhoc and fold_in, prefer fold_in.'

function cannedEntryMapping(text: string): EntryMapping {
  const t = text.toLowerCase()
  const base = { interpretation: `[demo] ${text}`, sceneEffects: null }
  if (/\b(take on|begin|face|engage|attempt)\b/.test(t)) return { ...base, entry: 'offered' }
  if (/\b(instead|off-script|on my own|side venture)\b/.test(t)) return { ...base, entry: 'adhoc' }
  return { ...base, entry: 'fold_in' }
}

export interface EntryContext {
  text: string
  actorSummary: string
  sceneSummary: string
  /** The offered encounter from the open beat's spec, if any. */
  hook: { kind: string; label: string; stakes: string } | null
  knownLocations: string[]
  knownNpcs: string[]
  recentEvents: string[]
  /** Recently folded-in replies - a repeat/continuation of one of these must not fold again. */
  recentFolds: string[]
}

export async function runEntryMapper(env: AgentEnv, ctx: EntryContext): Promise<EntryMapping> {
  if (env.demo) return cannedEntryMapping(ctx.text)
  const user = [
    `Reply: ${ctx.text}`,
    `Actor: ${ctx.actorSummary}`,
    `Scene: ${ctx.sceneSummary}`,
    ctx.hook
      ? `Offered encounter: ${ctx.hook.kind} - "${ctx.hook.label}" (stakes: ${ctx.hook.stakes || 'unstated'})`
      : 'No encounter is on offer right now - only "adhoc" or "fold_in" apply.',
    `Known locations: ${ctx.knownLocations.join('; ') || 'none listed'}`,
    `Named NPCs: ${ctx.knownNpcs.join('; ') || 'none listed'}`,
    `Recent events: ${ctx.recentEvents.join(' | ') || 'none'}`,
    ctx.recentFolds.length > 0
      ? `Already folded in (a repeat or continuation of these is COMMITMENT - never fold_in again): ${ctx.recentFolds.map((f) => `"${f}"`).join(' | ')}`
      : '',
  ].filter(Boolean).join('\n')
  const raw = await agentJson(env, 'adjudicator', ENTRY_SYSTEM, user, 300)
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const entry = (['offered', 'adhoc', 'fold_in'] as const).find((e) => e === obj.entry) ?? 'fold_in'
  const effects = extractSceneEffects(raw)
  return {
    // "offered" with nothing on offer is a model error - degrade to fold_in, never a crash.
    entry: !ctx.hook && entry === 'offered' ? 'fold_in' : entry,
    interpretation: typeof obj.interpretation === 'string' && obj.interpretation.trim()
      ? obj.interpretation.trim()
      : ctx.text.slice(0, 120),
    // Progression rides on outcome maps only - strip everything but world movement.
    sceneEffects: effects
      ? { ...effects, milestones: [], markEvent: null, encounter: null }
      : null,
  }
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
    ctx.recentLines.length > 0 ? `This scene so far:\n${ctx.recentLines.slice(-6).join('\n')}` : '',
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

const NARRATOR_BASE =
  'You narrate a tabletop RPG. Second person, present tense, 2-4 sentences, vivid but concise. ' +
  'Never invent facts about named NPCs/items/places beyond the given context. Never mention ' +
  'dice, rolls, checks, or game mechanics - translate outcomes into fiction. Never presume the ' +
  'party\'s motivation or feelings; motivation belongs to the players. When a party member\'s ' +
  'described traits or quirks bear on the moment (a dwarf\'s Darkvision in the dark, a ' +
  'sailor\'s eye for rigging), let the narration notice it - personal, never generic. ' +
  'Output only narration text.'

/**
 * 'beat' opens situations and must end on a choice; 'outcome' resolves and may settle;
 * 'exposition' is the cutscene voice (encounter-states Slice 3): longer-form, ends with an
 * explicit in-fiction ask telegraphing the encounter ahead.
 */
export type NarrationStyle = 'beat' | 'outcome' | 'exposition'

const NARRATOR_SYSTEMS: Record<NarrationStyle, string> = {
  beat:
    NARRATOR_BASE +
    ' End every narration at a concrete decision point facing the players - someone awaiting ' +
    'their answer, a fork, a threat, an open question - never a settled scene. Vary how beats ' +
    'end - no formulaic closing line. A decision point is a REAL choice or a demanded action: ' +
    'never re-offer a choice the party already made, and never invent a fork for its own ' +
    'sake - when the fiction has one way onward, commit them toward it and end at what it ' +
    'reveals or demands.',
  outcome:
    NARRATOR_BASE +
    ' Narrate the resolved outcome and let the scene settle where it naturally lands - never ' +
    'force a closing question, but never strand the players either: make the immediate ' +
    'situation concrete and leave at least one visible thread to pull (a path, a person, a ' +
    'sound, a detail worth a closer look) so they always know what they could engage with next.',
  exposition:
    'You narrate a tabletop RPG. Second person, present tense. This is a CUTSCENE between ' +
    'encounters: 4-8 sentences of vivid exposition that carries consequences forward and sets ' +
    'the next situation. Never invent facts about named NPCs/items/places beyond the given ' +
    'context. Never mention dice, rolls, checks, or game mechanics. Never presume the party\'s ' +
    'motivation or feelings. Let the party members\' described traits, backgrounds, and quirks ' +
    'color what each of them would notice or be drawn toward. END with an explicit in-fiction ' +
    'ask that telegraphs 1-3 concrete directions the party could take - someone waiting on ' +
    'their answer, a visible approach, a pressing danger. Never re-offer a direction the ' +
    'party already chose, and never pad a single obvious path into a menu: if one way onward ' +
    'exists, carry them down it and end at what it reveals. The players\' reply enters the ' +
    'next encounter. Output only narration text.',
}

export async function runNarrator(
  env: AgentEnv,
  prompt: string,
  constraint?: string,
  style: NarrationStyle = 'beat',
): Promise<string> {
  if (env.demo) return `[demo narration] ${prompt.slice(0, 140)}`
  const system = NARRATOR_SYSTEMS[style]
  return await callAgentText({
    serviceClient: env.service,
    openRouterApiKey: OPENROUTER_API_KEY,
    userId: env.creatorId,
    adventureId: env.adventureId,
    agentRole: 'narrator',
    system: constraint ? `${system}\nHard constraints: ${constraint}` : system,
    user: prompt,
    maxTokens: 500,
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
  // Same intermittent structured-output failure the NPC agent guards against: the model
  // answers, but not as {"options":[...]}, so the parse yields nothing and narrate_next 502s
  // ("Narrator produced no options", seen live 2026-07-20). callAgentText's retry only covers
  // EMPTY completions - a malformed shape needs a fresh attempt here. 300 tokens was also tight
  // for 4 summaries once leaked reasoning tokens eat the budget.
  const attempt = async () => parseNarrationOptions(await agentJson(
    env,
    'narrator',
    'Offer 3-4 directions the story could go next. Reply with ONLY JSON: {"options": [{"summary": "one sentence"}]}.',
    contextPrompt,
    600,
    NARRATION_OPTIONS_SCHEMA,
  ))
  const options = await attempt().catch(() => [])
  return options.length > 0 ? options : await attempt()
}

const CONSISTENCY_SYSTEM =
  'You fact-check a game narration draft against established facts. ' +
  // Shape is fixed by CONSISTENCY_SCHEMA; restating it here only spent tokens on a call whose
  // replies were already coming back truncated ('{"' at 2 chars, live 2026-07-21).
  'Tone and style ' +
  'are free - flag only DIRECT contradictions of a stated fact (dead people acting, a different ' +
  'location than the stated one, items nobody has). NEW details, characters, or embellishments ' +
  'the facts are silent about are the narrator\'s job - never violations. ' +
  // A blocked draft costs two regenerations and then falls back to a canned mechanical line, so
  // a false positive is worse for the player than the embellishment it prevented. This one fired
  // live: "a figure diligently writes" was flagged against "Duke Eldrin is dead".
  'An UNNAMED person - "a figure", "a scribe", "someone" - is a new character, not a dead one ' +
  'returning: flag it only if the draft itself says who they are. Judge the words on the page, ' +
  'never who you suspect they might be. ' +
  // The party roster is a cast list, not a guest list. Read as the latter it makes every NPC
  // action a "contradiction" (live 2026-07-23).
  'A character acting who is NOT in the party is NORMAL - the party list names the PLAYER ' +
  'characters only, and the world is full of other people. Never flag someone merely for being ' +
  'absent from a list; flag only what the facts positively contradict. When in doubt, ok: true.'

/** Deterministic pass first (F07 SS6.1); LLM pass only for non-demo (SS6.2). */
export async function runConsistency(
  env: AgentEnv,
  draft: string,
  npcs: { id: string; name: string }[],
  npcStates: Record<string, string>,
  factSheet: string,
  opts?: {
    draftIsNpcSpeech?: boolean
    draftAssertsCanon?: boolean
    /** Canon's closed menu of contradictable facts. Absent = legacy free-text mode. */
    restrictions?: { id: string; text: string }[]
  },
): Promise<ConsistencyVerdict> {
  const violations: ConsistencyVerdict['violations'] = []
  // Naming a dead NPC is only a contradiction when the draft IS that NPC talking. A murder
  // mystery says its victim's name constantly - blocking every mention made the narrator fall
  // back to mechanical text six times in one session, unable to describe the body it was
  // standing over (live 2026-07-21). The dead are kept off stage by the staging guard and by
  // this check on their own dialogue; narration may discuss them freely, and the LLM checker
  // still catches a draft that has them walking and speaking.
  if (opts?.draftIsNpcSpeech) {
    // STRUCTURAL, not textual: this draft IS the speech of the NPCs passed in, so a dead or
    // absent speaker is a contradiction no matter what the words say. Matching their name
    // against the text was the old shape and it confused MENTIONING a fact with VIOLATING it.
    for (const npc of npcs) {
      const state = npcStates[npc.id]
      if (state === 'dead' || state === 'absent') {
        violations.push({ claim: `speaks as ${npc.name}`, conflictsWith: `${npc.name} is ${state}` })
      }
    }
  }
  if (violations.length > 0) return { ok: false, violations }
  if (env.demo) {
    // Canned checker for the $0 suites, and ONLY for drafts that assert new canon (a player
    // theory being made true). Production sends that judgement to the LLM with the dead/absent
    // roster in the fact sheet; demo has no model, so the fixture approximates it by name -
    // legitimate in a test double, never in production. Narration is deliberately exempt:
    // matching a name against prose is what silenced the narrator about its own murder victim.
    if (!opts?.draftAssertsCanon) return { ok: true, violations: [] }
    const deadMentioned = npcs.filter((n) =>
      (npcStates[n.id] === 'dead' || npcStates[n.id] === 'absent') &&
      n.name && draft.toLowerCase().includes(n.name.toLowerCase()))
    return deadMentioned.length === 0
      ? { ok: true, violations: [] }
      : {
          ok: false,
          violations: deadMentioned.map((n) => ({
            claim: `[demo] mentions ${n.name}`, conflictsWith: `${n.name} is ${npcStates[n.id]}`,
          })),
        }
  }
  // Nothing restrictive in this scene means nothing CAN be contradicted - so there is no
  // question to ask. Skips the most-called agent in the app (88 calls in one 50-turn run)
  // whenever nobody is dead, absent, or holding a committed fact.
  const restrictionIds = (opts?.restrictions ?? []).map((r) => r.id)
  if (opts?.restrictions !== undefined && restrictionIds.length === 0) {
    return { ok: true, violations: [] }
  }
  try {
    const raw = await agentJson(
      env, 'consistency_checker', CONSISTENCY_SYSTEM,
      `Facts:\n${factSheet}\n\nDraft:\n${draft}`, 300,
      restrictionIds.length > 0 ? consistencySchemaFor(restrictionIds) : CONSISTENCY_SCHEMA,
    )
    // Both deterministic gates: the cited restriction must exist, and the quoted claim must
    // actually be in the draft. An unverifiable violation never silences the narrator.
    return parseConsistency(raw, {
      allowedIds: restrictionIds.length > 0 ? restrictionIds : undefined,
      draft: restrictionIds.length > 0 ? draft : undefined,
    })
  } catch {
    return { ok: true, violations: [] } // checker outage must not block play; incidents log elsewhere
  }
}

const OFFER_SYSTEM =
  'The party faces an open quest offer in a D&D-style game. Classify their utterance as a response ' +
  'to it. Reply with ONLY JSON: {"response": "accept"|"decline"|"negotiate"|"unrelated"}. ' +
  '"accept" only on a clear yes to taking the job; "decline" on a clear refusal; "negotiate" when ' +
  'they push for better terms or payment; anything else - questions about the job, small talk, ' +
  'unrelated actions - is "unrelated". When unsure, "unrelated".'

function cannedOfferResponse(text: string): OfferResponseKind {
  const t = text.toLowerCase()
  if (/(more gold|pay us more|double|sweeten|better terms|for that price|make it worth)/.test(t)) return 'negotiate'
  if (/(we accept|i accept|we'll do it|we will do it|you have a deal|count us in|we'll take the job|we take the job)/.test(t)) return 'accept'
  if (/(we decline|not interested|find someone else|no deal|we refuse|we won't do it)/.test(t)) return 'decline'
  return 'unrelated'
}

/** F08 SS2.1: free-text accept/decline/negotiate detection. Failure degrades to 'unrelated'. */
export async function runOfferClassifier(env: AgentEnv, offerSummary: string, utterance: string): Promise<OfferResponseKind> {
  if (env.demo) return cannedOfferResponse(utterance)
  try {
    return parseOfferResponse(
      await agentJson(env, 'adjudicator', OFFER_SYSTEM, `Offer on the table: ${offerSummary}\nUtterance: ${utterance}`, 100),
    )
  } catch {
    return 'unrelated' // classification failure = normal routing, never a blocked table
  }
}

const PUZZLE_JUDGE_SYSTEM =
  'A puzzle is in play in a tabletop RPG and YOU hold its secret solution. Score the party\'s ' +
  'attempt. Reply with ONLY JSON: {"attempt_result": "solves"|"advances_step"|"mistaken"|"talk", ' +
  '"note": string (one line for the narrator - NEVER reveal the solution or unearned steps)}. ' +
  '"solves" only when the attempt actually enacts the solution (or completes the final missing ' +
  'piece); "advances_step" when it genuinely accomplishes the CURRENT step; "talk" when the ' +
  'input is a question or conversation rather than an attempt (it costs nothing); "mistaken" for ' +
  'everything else - wrong ideas, wild guesses, unrelated fiddling. Be strict: reward real ' +
  'reasoning, not verbs.'

export interface PuzzleJudgment {
  result: 'solves' | 'advances_step' | 'mistaken' | 'talk'
  note: string
}

/** Scores a puzzle attempt against the secret solution (encounter-states Slice 5). */
export async function runPuzzleJudge(
  env: AgentEnv,
  ctx: {
    solution: string
    steps: { description: string; done: boolean }[]
    attempt: string
    actorName: string
  },
): Promise<PuzzleJudgment> {
  if (env.demo) {
    const t = ctx.attempt.toLowerCase()
    if (/\?\s*$/.test(ctx.attempt)) return { result: 'talk', note: '[demo] a question for the DM' }
    const solutionWords = ctx.solution.toLowerCase().split(/\W+/).filter((w) => w.length >= 5)
    if (solutionWords.some((w) => t.includes(w))) return { result: 'solves', note: '[demo] the pieces align' }
    if (/(examine|study|trace|align|press|turn)/.test(t)) return { result: 'advances_step', note: '[demo] a step yields' }
    return { result: 'mistaken', note: '[demo] nothing gives' }
  }
  const raw = await agentJson(env, 'adjudicator', PUZZLE_JUDGE_SYSTEM, [
    `SECRET solution: ${ctx.solution}`,
    `Steps (in order):\n${ctx.steps.map((s, i) => `${i + 1}. [${s.done ? 'DONE' : 'open'}] ${s.description}`).join('\n')}`,
    `Current step: the first open one.`,
    `${ctx.actorName} attempts: ${ctx.attempt}`,
  ].join('\n'), 200)
  const obj = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const result = (['solves', 'advances_step', 'mistaken', 'talk'] as const).find((r) => r === obj.attempt_result) ?? 'mistaken'
  return { result, note: typeof obj.note === 'string' ? obj.note.slice(0, 200) : '' }
}

const EXIT_JUDGE_SYSTEM =
  'A social encounter in a tabletop RPG has 2-4 authored exit outcomes. Judge whether one has ' +
  'CLEARLY occurred in the recent exchange. Reply with ONLY JSON: {"exit": "<outcome label ' +
  'copied EXACTLY>" | null}. Only claim an exit the transcript unambiguously establishes - ' +
  'agreed, refused outright, enraged, and so on. Merely discussing, hesitating, or trending ' +
  'toward an outcome is NOT an exit. The usual answer is {"exit": null}.'

/**
 * Narrow exit detection for social encounters (encounter-states Slice 4): judges ONLY the
 * authored exits, never open recognition. Demo: an exit label appearing verbatim in the
 * recent lines counts. Failure degrades to null - the conversation simply continues.
 */
export async function runSocialExitJudge(
  env: AgentEnv,
  goal: string,
  exits: { outcome: string; description: string }[],
  recentLines: string[],
): Promise<string | null> {
  if (exits.length === 0) return null
  if (env.demo) {
    const text = recentLines.slice(-4).join(' ').toLowerCase()
    return exits.find((e) => text.includes(e.outcome.toLowerCase().replaceAll('_', ' ')))?.outcome ?? null
  }
  try {
    const raw = await agentJson(env, 'summarizer', EXIT_JUDGE_SYSTEM, [
      `Goal of the conversation: ${goal || 'unstated'}`,
      `Authored exits:\n${exits.map((e) => `- ${e.outcome}: ${e.description}`).join('\n')}`,
      `Recent exchange:\n${recentLines.slice(-8).join('\n')}`,
    ].join('\n\n'), 100)
    const exit = (typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>).exit : null)
    return typeof exit === 'string' && exits.some((e) => e.outcome === exit) ? exit : null
  } catch {
    return null
  }
}

const OBJECTIVE_JUDGE_SYSTEM =
  'You judge whether a tabletop RPG party has COMPLETED the current story objective - the way a ' +
  'DM recognizes an accomplishment however the players got there, including routes the authors ' +
  'never anticipated. You are given the objective (player-facing title + DM-only notes on what ' +
  'it is REALLY about), the authored milestone atoms that can credit it, and the recent play. ' +
  'Reply with ONLY JSON: {"completed": boolean, "atom": string|null, "evidence": string}. ' +
  'completed true ONLY when the recent lines make it unambiguous the objective\'s real intent ' +
  'has been ACHIEVED on the page - done, not planned, discussed, attempted, or approached. ' +
  'An ENABLING event is NOT completion: a way opening, a threshold reached, a person arriving ' +
  'in view, permission granted, an opportunity created - none of these are the deed itself ' +
  '(a door groaning open is not yet entering; a claimant stepping from a coach is not yet a ' +
  'meeting). The evidence must show the accomplished STATE, not the moment it became possible. ' +
  'evidence MUST be a short verbatim quote from the provided lines that proves it; if you ' +
  'cannot quote proof, completed is false. atom: the ONE provided milestone whose meaning best ' +
  'matches what actually happened (the vehicle for crediting), null when completed is false. ' +
  'Judge only the words on the page, never what you suspect happened off it. Partial progress ' +
  'is false. When in doubt, false - most calls should answer false.'

export interface ObjectiveJudgment {
  completed: boolean
  atom: string | null
  evidence: string
}

/**
 * Holistic objective recognition (the "DM's judgment" net under the deterministic predicate
 * path). Runs ONLY at resolution boundaries the caller gates structurally (beat exit/spent with
 * the objective still incomplete - never per turn, never on word signals). Failure degrades to
 * null: recognition is an extra chance to credit the party, never a way to block the tail.
 */
export async function runObjectiveJudge(
  env: AgentEnv,
  ctx: {
    objective: { title: string; hiddenDescription: string }
    /** The objective's own claimable atoms - the only credit vehicles the judge may cite. */
    atoms: string[]
    recentLines: string[]
  },
): Promise<ObjectiveJudgment | null> {
  // Live-play feature only: demo adventures assert canned outputs and must spend nothing.
  if (env.demo || ctx.atoms.length === 0) return null
  const schema = {
    name: 'objective_judgment',
    schema: obj({
      completed: { type: 'boolean' },
      atom: { anyOf: [{ type: 'string', enum: ctx.atoms }, { type: 'null' }] },
      evidence: { type: 'string', maxLength: 240 },
    }),
  }
  try {
    const raw = await agentJson(env, 'adjudicator', OBJECTIVE_JUDGE_SYSTEM, [
      `Objective: ${ctx.objective.title}`,
      `DM notes (what it is really about): ${ctx.objective.hiddenDescription || 'none'}`,
      `Milestone atoms that can credit it: ${ctx.atoms.join(' | ')}`,
      `Recent play (judge ONLY these lines):\n${ctx.recentLines.join('\n')}`,
    ].join('\n'), 250, schema)
    const o = (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
    const atom = typeof o.atom === 'string' && ctx.atoms.includes(o.atom) ? o.atom : null
    const evidence = typeof o.evidence === 'string' ? o.evidence.trim().slice(0, 240) : ''
    // The guardrail IS the citation: a yes without a quoted proof and a valid atom is a no.
    const completed = o.completed === true && atom !== null && evidence.length > 0
    return { completed, atom: completed ? atom : null, evidence }
  } catch {
    return null
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
