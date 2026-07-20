// Encounter frame plumbing (encounter-states Slices 1-2): open/close diffs, event logging,
// and the skill-challenge flow. The visible frame lives in GameState.encounter; the hidden
// half (outcome maps, kind secrets) in dm.encounterSpec so it never reaches players. The
// engine itself is pure (_shared/play/skill-challenge.ts) - this module wires it to the
// Adjudicator, the pending-check lifecycle, and the story-progress pass.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  escalatedDc, newSkillChallenge, promptDeadline, recordAttempt, SOLO_PROMPT_WINDOW_S,
} from '../_shared/play/index.ts'
import type { CheckResult, SkillChallengeState } from '../_shared/play/index.ts'
import type {
  EncounterKind, EncounterSpecState, EncounterState, GameState, Json, PendingPromptState, StateDiff,
} from '../_shared/state/index.ts'
import { runAdjudicator } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { maybeSpawnEncounter } from './danger.ts'
import type { SpawnInstantiator } from './danger.ts'
import { discoverAtLocation, discoveryNote } from './discovery.ts'
import { writeMemoryFragment } from './memory.ts'
import { applyMilestones } from './milestones.ts'
import { narrationBeat } from './narration.ts'
import {
  activePcIds, appendLinesDiff, characterProfiles, loadPartyCharacters, newLine, partySkillList,
  pendingDiffs, typingDiff,
} from './orchestrate.ts'
import type { CharacterRow } from './orchestrate.ts'
import { evaluateStoryProgress } from './progress.ts'
import { recordProposal } from './proposals.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

export function activeEncounter(state: GameState): EncounterState | null {
  return state.encounter ?? null
}

export function newEncounter(kind: EncounterKind, label: string, stakes: string, progress: Json): EncounterState {
  return {
    id: crypto.randomUUID(),
    kind,
    label,
    stakes,
    progress,
    contributions: {},
    startedAt: new Date().toISOString(),
  }
}

/**
 * Whole-frame REPLACE: a bare object patch would merge-patch into any existing frame
 * (stale progress keys, self-referential interrupted stacks - seen in the Slice 6 restore),
 * so the domain is cleared first and set in the same commit.
 */
export function encounterReplaceDiffs(encounter: EncounterState | null): StateDiff[] {
  return [
    { domain: 'encounter', patch: null },
    ...(encounter ? [{ domain: 'encounter' as const, patch: encounter as unknown as Json }] : []),
  ]
}

/** The hidden spec needs the same clear-then-set treatment (nested params/interrupted). */
function specReplaceDiffs(spec: EncounterSpecState | null): StateDiff[] {
  return [
    { domain: 'dm', patch: { encounterSpec: null } },
    ...(spec ? [{ domain: 'dm' as const, patch: { encounterSpec: spec as unknown as Json } }] : []),
  ]
}

export async function openEncounter(
  service: SupabaseClient,
  adventureId: string,
  sessionId: string | null,
  encounter: EncounterState,
  spec: EncounterSpecState,
): Promise<void> {
  await commitDiffs(service, adventureId, () => [
    ...encounterReplaceDiffs(encounter),
    ...specReplaceDiffs(spec),
  ])
  await logEvent(service, adventureId, sessionId, 'encounter_opened', {
    encounter_id: encounter.id, kind: encounter.kind, label: encounter.label, stakes: encounter.stakes,
  })
}

export type ResolutionTier = 'full' | 'partial' | 'failed'

/**
 * Deterministic resolution: tier -> outcome map -> applyMilestones (validated), close the
 * frame + hidden spec (or restore the interrupted encounter, Slice 6), narrate the
 * resolution, then run the story-progress pass. A failed challenge/puzzle is itself a
 * transition point - the world may pile on.
 */
export async function resolveOpenEncounter(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  tier: ResolutionTier,
  narrationContext: string,
): Promise<void> {
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (!encounter) return
  const spec = state.dm?.encounterSpec ?? { onSuccess: [], onPartial: [], onFailure: [] }
  const mapped = tier === 'failed' ? spec.onFailure : tier === 'partial' ? spec.onPartial : spec.onSuccess
  const applied = mapped.length > 0
    ? await applyMilestones(service, env, sessionId, mapped, 'encounter_outcome')
    : []

  const restored = encounter.interrupted ?? null
  const restoredSpec = spec.interrupted ?? null
  await commitDiffs(service, env.adventureId, (s) => [
    ...encounterReplaceDiffs(restored),
    ...specReplaceDiffs(restored ? restoredSpec : null),
    // Puzzle mode follows its encounter (battle mode is Phase 7's problem).
    ...(s.scene.mode === 'puzzle' && restored?.kind !== 'puzzle'
      ? [{ domain: 'scene' as const, patch: { mode: 'narration' } as Json }]
      : []),
    ...(restored?.kind === 'puzzle' && s.scene.mode !== 'puzzle'
      ? [{ domain: 'scene' as const, patch: { mode: 'puzzle' } as Json }]
      : []),
  ])
  await logEvent(service, env.adventureId, sessionId, 'encounter_resolved', {
    encounter_id: encounter.id, kind: encounter.kind, label: encounter.label,
    tier, milestones: applied as unknown as Json,
  })
  if (restored) {
    await logEvent(service, env.adventureId, sessionId, 'encounter_restored', {
      encounter_id: restored.id, kind: restored.kind, label: restored.label,
    })
  }
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'encounter_resolution',
    payload: { encounter_id: encounter.id, kind: encounter.kind, tier, milestones: applied } as unknown as Json,
    mode: 'auto',
    summary: `${encounter.kind} "${encounter.label}" resolved: ${tier}`,
  })

  // Memory write path (Slice 7): the resolution becomes a retrievable fragment.
  await writeMemoryFragment(
    service, env, 'encounter',
    `${encounter.kind.replaceAll('_', ' ')} "${encounter.label}" ended in ${tier === 'failed' ? 'failure' : `${tier} success`}` +
      (encounter.stakes ? ` (stakes: ${encounter.stakes})` : '') + `. ${narrationContext}`,
  )

  const tierText = tier === 'failed'
    ? 'The party has FAILED it - narrate the fail-forward consequences; the story moves on, worse.'
    : tier === 'partial'
      ? 'The party succeeded, but only just - narrate success with a visible cost or complication.'
      : 'The party succeeded fully, together - narrate a clean, earned success.'
  // The resolution cutscene (exposition voice): consequences forward, next hook at the end.
  await narrationBeat(
    service, env, sessionId,
    `The "${encounter.label}" ${encounter.kind.replaceAll('_', ' ')} encounter has concluded. ` +
      `${narrationContext} ${tierText}` +
      (encounter.stakes ? ` The stakes were: ${encounter.stakes}.` : '') +
      (restored
        ? ` Then bring the party straight back to their interrupted business: "${restored.label}" still stands unfinished - end there.`
        : ''),
    'Encounter resolved',
    'exposition',
  )
  await evaluateStoryProgress(service, env, sessionId)

  const isSpawned = typeof spec.params === 'object' && spec.params !== null && !Array.isArray(spec.params) &&
    (spec.params as Record<string, Json>).spawned === true
  if (tier === 'failed' && !restored && !isSpawned && (encounter.kind === 'skill_challenge' || encounter.kind === 'puzzle')) {
    // Runs after the progress pass cleared typing - hold the indicator through the roll and
    // any spawn narration so the table never looks stuck mid-chain.
    await commitDiffs(service, env.adventureId, () => [typingDiff(true)]).catch(() => {})
    try {
      await maybeSpawnEncounter(service, env, sessionId, 'encounter_failure', spawnInstantiator(service, env, sessionId))
    } finally {
      await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
    }
  }
}

/** Builds the injected spawn callback (Slice 6): interrupts the open encounter, if any. */
export function spawnInstantiator(service: SupabaseClient, env: AgentEnv, sessionId: string): SpawnInstantiator {
  return async (entry) => {
    const state = (await loadState(service, env.adventureId)).state
    const current = activeEncounter(state)
    const currentSpec = state.dm?.encounterSpec ?? null
    const params = (typeof entry.params === 'object' && entry.params !== null && !Array.isArray(entry.params)
      ? entry.params
      : {}) as Record<string, Json>
    const spawnedSpec: EncounterSpecState = {
      onSuccess: [], onPartial: [], onFailure: [],
      params: { ...params, spawned: true },
      interrupted: currentSpec,
    }

    if (entry.kind === 'combat') {
      const frame: EncounterState = { ...newEncounter('combat', entry.label, '', { placeholder: true }), interrupted: current }
      await openEncounter(service, env.adventureId, sessionId, frame, spawnedSpec)
      await commitDiffs(service, env.adventureId, (s) => [
        appendLinesDiff(s, [newLine(null, null, `Combat: ${entry.label} - party victorious (placeholder auto-resolve)`)]),
      ])
      await resolveOpenEncounter(
        service, env, sessionId, 'full',
        `Out of nowhere, a fight ("${entry.label}") crashed into the party - and they won decisively.`,
      )
      return
    }

    const num = (v: Json | undefined, fallback: number) => (typeof v === 'number' ? v : fallback)
    const challenge = newSkillChallenge({
      neededSuccesses: num(params.needed_successes, 2),
      maxFailures: num(params.max_failures, 2),
      suggestedSkills: Array.isArray(params.suggested_skills)
        ? (params.suggested_skills as Json[]).filter((s): s is string => typeof s === 'string')
        : [],
      activePcIds: await activePcIds(service, env.adventureId),
    })
    const frame: EncounterState = {
      ...newEncounter('skill_challenge', entry.label, '', challengeProgressJson(challenge)),
      interrupted: current,
    }
    await openEncounter(service, env.adventureId, sessionId, frame, spawnedSpec)
    await narrationBeat(
      service, env, sessionId,
      `Without warning, the world interrupts: "${entry.label}".` +
        (current ? ` It cuts straight across the party's business with "${current.label}".` : '') +
        ' Make the danger immediate and concrete, and end demanding the party\'s instant reaction.',
      'Random encounter',
    )
  }
}

// --- Beat specs (Slice 3) --------------------------------------------------------------------

/** The beat row's stored spec shape (snake_case jsonb written by planAndOpenBeat). */
export interface StoredBeatSpec {
  kind: string
  label: string
  stakes: string
  params: Record<string, Json>
  onSuccess: string[]
  onPartial: string[]
  onFailure: string[]
}

export function parseStoredBeatSpec(raw: Json): StoredBeatSpec | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, Json>
  if (typeof obj.kind !== 'string' || typeof obj.label !== 'string' || !obj.label.trim()) return null
  const strings = (v: Json | undefined) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  return {
    kind: obj.kind,
    label: obj.label,
    stakes: typeof obj.stakes === 'string' ? obj.stakes : '',
    params: (typeof obj.params === 'object' && obj.params !== null && !Array.isArray(obj.params)
      ? obj.params
      : {}) as Record<string, Json>,
    onSuccess: strings(obj.on_success),
    onPartial: strings(obj.on_partial),
    onFailure: strings(obj.on_failure),
  }
}

function specState(spec: StoredBeatSpec): EncounterSpecState {
  return { onSuccess: spec.onSuccess, onPartial: spec.onPartial, onFailure: spec.onFailure, params: spec.params }
}

/** Instantiates a skill-challenge frame from a stored spec (authored or ad-hoc). */
export async function openSkillChallengeFromSpec(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  spec: StoredBeatSpec,
): Promise<EncounterState> {
  const num = (v: Json | undefined, fallback: number) => (typeof v === 'number' ? v : fallback)
  const challenge = newSkillChallenge({
    neededSuccesses: num(spec.params.needed_successes, 3),
    maxFailures: num(spec.params.max_failures, 2),
    suggestedSkills: Array.isArray(spec.params.suggested_skills)
      ? (spec.params.suggested_skills as Json[]).filter((s): s is string => typeof s === 'string')
      : [],
    activePcIds: await activePcIds(service, env.adventureId),
  })
  const encounter = newEncounter('skill_challenge', spec.label, spec.stakes, challengeProgressJson(challenge))
  await openEncounter(service, env.adventureId, sessionId, encounter, specState(spec))
  return encounter
}

/** Combat stays the pre-Phase 7 placeholder: instant party victory, full tier, outcome map. */
export async function runCombatPlaceholderEncounter(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  spec: StoredBeatSpec,
): Promise<void> {
  const encounter = newEncounter('combat', spec.label, spec.stakes, { placeholder: true })
  await openEncounter(service, env.adventureId, sessionId, encounter, specState(spec))
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(null, null, `Combat: ${spec.label} - party victorious (placeholder auto-resolve)`)]),
  ])
  await resolveOpenEncounter(
    service, env, sessionId, 'full',
    `A fight ("${spec.label}") broke out and the party won decisively - carry the clash and its aftermath.`,
  )
}

// --- Skill challenge (Slice 2) ---------------------------------------------------------------

export interface ChallengeCheckStash {
  flow: 'challenge'
  utterance: string
  actorCharacterId: string
  actorName: string
  interpretation: string
  consequencesHint: string
  skill: string
  dc: number
  /** Per-option DCs (repeat-skill escalation differs per skill); rollPending picks by choice. */
  dcBySkill?: Record<string, number>
}

function challengeFromEncounter(encounter: EncounterState): SkillChallengeState {
  const p = (typeof encounter.progress === 'object' && encounter.progress !== null && !Array.isArray(encounter.progress)
    ? encounter.progress
    : {}) as Record<string, Json>
  const num = (v: Json | undefined, fallback: number) => (typeof v === 'number' ? v : fallback)
  const strings = (v: Json | undefined) =>
    Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : []
  return {
    neededSuccesses: num(p.neededSuccesses, 3),
    maxFailures: num(p.maxFailures, 2),
    suggestedSkills: strings(p.suggestedSkills),
    perSkillUses: (typeof p.perSkillUses === 'object' && p.perSkillUses !== null && !Array.isArray(p.perSkillUses)
      ? p.perSkillUses
      : {}) as Record<string, number>,
    successes: num(p.successes, 0),
    failures: num(p.failures, 0),
    contributions: encounter.contributions,
    activePcIds: strings(p.activePcIds),
  }
}

function challengeProgressJson(challenge: SkillChallengeState): Json {
  return {
    neededSuccesses: challenge.neededSuccesses,
    maxFailures: challenge.maxFailures,
    suggestedSkills: challenge.suggestedSkills,
    perSkillUses: challenge.perSkillUses,
    successes: challenge.successes,
    failures: challenge.failures,
    activePcIds: challenge.activePcIds,
  }
}

function progressNote(challenge: SkillChallengeState, label: string): string {
  return `Challenge "${label}": ${challenge.successes}/${challenge.neededSuccesses} successes, ` +
    `${challenge.failures}/${challenge.maxFailures} setbacks.`
}

/** Body fields -> a StoredBeatSpec (dm_command open_encounter seeding surface). */
export function specFromCommandBody(kind: string, body: Record<string, unknown>): StoredBeatSpec {
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  return {
    kind,
    label: String(body.label ?? '').trim(),
    stakes: String(body.stakes ?? ''),
    params: {
      goal: String(body.goal ?? ''),
      npc_ids: strings(body.npc_ids) as unknown as Json,
      exits: (Array.isArray(body.exits) ? body.exits : []) as Json,
    },
    onSuccess: strings(body.on_success),
    onPartial: strings(body.on_partial),
    onFailure: strings(body.on_failure),
  }
}

/** DM/test seeding surface: dm_command open_encounter (skill_challenge; social via intent.ts). */
export async function openEncounterCommand(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const state = (await loadState(service, env.adventureId)).state
  if (activeEncounter(state)) return { status: 409, body: { error: 'An encounter is already open' } }
  // body.kind is the intent kind (dm_command) - the encounter's kind rides in encounter_kind.
  const kind = String(body.encounter_kind ?? '')
  const label = String(body.label ?? '').trim()
  if (!label) return { status: 400, body: { error: 'label required' } }
  const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === 'string') : [])
  if (kind !== 'skill_challenge') {
    return { status: 400, body: { error: `Unsupported encounter_kind: ${kind}` } }
  }

  const challenge = newSkillChallenge({
    neededSuccesses: Number(body.needed_successes ?? 3),
    maxFailures: Number(body.max_failures ?? 2),
    suggestedSkills: strings(body.suggested_skills),
    activePcIds: await activePcIds(service, env.adventureId),
  })
  const encounter = newEncounter('skill_challenge', label, String(body.stakes ?? ''), challengeProgressJson(challenge))
  const spec: EncounterSpecState = {
    onSuccess: strings(body.on_success),
    onPartial: strings(body.on_partial),
    onFailure: strings(body.on_failure),
  }
  await openEncounter(service, env.adventureId, sessionId, encounter, spec)
  return { status: 200, body: { ok: true, encounter_id: encounter.id, kind, label } }
}

/**
 * The do/bare-roll route while a skill challenge is open: the Adjudicator specs skill+DC as
 * usual (with the challenge frame in context), DCs escalate on repeated skills, and the
 * outcome feeds the engine. Checks stay solo inside a challenge - teamwork is participation
 * across PCs, not assist slots.
 */
export async function handleChallengeIntent(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  opts?: { lineAlreadyStaged?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!opts?.lineAlreadyStaged) {
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
    ])
  }

  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (!encounter || encounter.kind !== 'skill_challenge') {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    return { status: 409, body: { error: 'No skill challenge is open' } }
  }
  const challenge = challengeFromEncounter(encounter)
  // The Encounter Designer's authored read on which party traits bear on this challenge -
  // keeps mid-challenge rulings consistent with the design (2026-07-20).
  const specParams = state.dm?.encounterSpec?.params
  const traitNotes = typeof specParams === 'object' && specParams !== null && !Array.isArray(specParams) &&
    typeof (specParams as Record<string, Json>).trait_notes === 'string'
    ? ((specParams as Record<string, Json>).trait_notes as string)
    : ''

  const party = await loadPartyCharacters(service, env.adventureId)
  let adjudication
  try {
    const profiles = await characterProfiles(service, party)
    adjudication = await runAdjudicator(env, {
      intentText: text,
      actorSummary: profiles[character.id] ?? `${character.name}, level ${character.level} ${character.class_key ?? 'adventurer'}`,
      sceneSummary:
        `${state.scene.locationName || 'unknown place'} (${state.scene.mode}). ` +
        `ACTIVE SKILL CHALLENGE "${encounter.label}" - ${encounter.stakes || 'the outcome hangs on the party'}. ` +
        `${progressNote(challenge, encounter.label)} ` +
        `Suggested approaches: ${challenge.suggestedSkills.join(', ') || 'any'}. ` +
        (traitNotes ? `Party traits in play here: ${traitNotes}. ` : '') +
        'Non-trivial contributions to the challenge should be skill checks, not auto-successes.',
      objective: null,
      partySkills: partySkillList(party),
      partySize: party.length,
      recentEvents: state.dialogue.lines.slice(-5).map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`),
      knownLocations: [],
      knownNpcs: [],
      milestones: [],
    })
  } catch (err) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    throw err
  }

  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'ruling',
    payload: adjudication as unknown as Json,
    mode: env.mode === 'assist' && adjudication.flags.needsDm ? 'human' : 'auto',
    blocking: true,
    summary: `challenge ${adjudication.resolution.type}: ${adjudication.interpretation.slice(0, 50)}`,
  })
  if (env.mode === 'assist' && adjudication.flags.needsDm) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    return { status: 200, body: { ok: true, resolved: 'pending_dm' } }
  }

  const { resolution } = adjudication
  if (adjudication.flags.talk) {
    // A question or table talk mid-challenge (unified input): answer it, count nothing.
    return handleEncounterTalk(service, env, sessionId, character, text, { lineAlreadyStaged: true })
  }
  if (adjudication.flags.impossible) {
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(null, null, `${adjudication.interpretation} - but that simply isn't possible here.`)], { typing: false }),
    ])
    return { status: 200, body: { ok: true, resolved: 'impossible' } }
  }

  if (resolution.type !== 'check' || !resolution.check) {
    // No roll needed: the attempt still counts toward the challenge, one way or the other.
    const success = resolution.type === 'auto_success'
    const status = await applyChallengeAttempt(service, env, sessionId, {
      characterId: character.id,
      actorName: character.name,
      skill: 'resourcefulness',
      success,
      detail: success ? 'no roll needed' : 'doomed from the start',
      interpretation: adjudication.interpretation,
      consequencesHint: resolution.consequencesHint,
    })
    return { status: 200, body: { ok: true, resolved: resolution.type, challenge_status: status } }
  }

  const spec = resolution.check
  const options = spec.skillOptions.length > 0 ? spec.skillOptions : [spec.skill]
  // Repeat-skill escalation is per skill, so each pickable option carries its own DC.
  const dcBySkill = Object.fromEntries(
    options.map((s) => [s, escalatedDc(spec.dc, challenge.perSkillUses[s.toLowerCase()] ?? 0)]),
  )
  const uses = challenge.perSkillUses[spec.skill.toLowerCase()] ?? 0
  const dc = dcBySkill[spec.skill]
  const stash: ChallengeCheckStash = {
    flow: 'challenge',
    utterance: text,
    actorCharacterId: character.id,
    actorName: character.name,
    interpretation: adjudication.interpretation,
    consequencesHint: resolution.consequencesHint,
    skill: spec.skill,
    dc,
    dcBySkill,
  }
  const prompt: PendingPromptState = {
    kind: 'check',
    id: crypto.randomUUID(),
    actorCharacterId: character.id,
    skill: spec.skill,
    skillOptions: options,
    advDis: spec.advDis,
    reason: uses > 0 ? `${spec.rationale} (the same approach is getting harder)` : spec.rationale,
    deadline: promptDeadline(new Date(), SOLO_PROMPT_WINDOW_S),
  }
  await commitDiffs(service, env.adventureId, () => [...pendingDiffs(prompt, stash as unknown as Json), typingDiff(false)])
  await logEvent(service, env.adventureId, sessionId, 'check_prompted', {
    kind: 'challenge', skill: spec.skill, dc, escalated: uses > 0,
  })
  return { status: 200, body: { ok: true, resolved: 'check_prompted', skill: spec.skill, dc } }
}

/**
 * Say inside an encounter with no NPC staged (encounter-states follow-up, playtest
 * 2026-07-20): the player is addressing the DM - "is there an open door near me?" - and the
 * old chat route answered with silence. Narrate a grounded answer inside the encounter frame
 * without counting an attempt or advancing anything. Inputs never silently vanish.
 */
export async function handleEncounterTalk(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  opts?: { lineAlreadyStaged?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!opts?.lineAlreadyStaged) {
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
    ])
  }
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  await logEvent(service, env.adventureId, sessionId, 'encounter_talk', {
    encounter_id: encounter?.id ?? null, character_id: character.id, text: text.slice(0, 200),
  })
  await narrationBeat(
    service, env, sessionId,
    `Mid-encounter, ${character.name} says: "${text}". Answer them inside the fiction - ` +
      `describe only what they could plausibly perceive or know right now` +
      (encounter
        ? ` during "${encounter.label}"${encounter.stakes ? ` (at stake: ${encounter.stakes})` : ''}`
        : '') +
      '. Do NOT resolve, advance, or shortcut the encounter, and no new hidden information - ' +
      'then hand the moment straight back to them for their next move.',
    'Encounter talk',
    'outcome',
  )
  return { status: 200, body: { ok: true, resolved: 'encounter_talk' } }
}

/** Resumes a rolled (or DM-ruled) challenge check - the stash flow dispatcher lands here. */
export async function challengeCheckResolved(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  stash: ChallengeCheckStash,
  result: CheckResult & { skill: string },
  detail: string,
): Promise<void> {
  await applyChallengeAttempt(service, env, sessionId, {
    characterId: stash.actorCharacterId,
    actorName: stash.actorName,
    skill: result.skill,
    success: result.success,
    detail,
    interpretation: stash.interpretation,
    consequencesHint: stash.consequencesHint,
  })
}

interface AttemptInput {
  characterId: string
  actorName: string
  skill: string
  success: boolean
  detail: string
  interpretation: string
  consequencesHint: string
}

async function applyChallengeAttempt(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  attempt: AttemptInput,
): Promise<string> {
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (!encounter || encounter.kind !== 'skill_challenge') {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    return 'closed'
  }
  const { state: next, status } = recordAttempt(
    challengeFromEncounter(encounter), attempt.characterId, attempt.skill, attempt.success,
  )
  await commitDiffs(service, env.adventureId, () => [
    {
      domain: 'encounter',
      patch: { progress: challengeProgressJson(next), contributions: next.contributions as unknown as Json },
    },
  ])
  await logEvent(service, env.adventureId, sessionId, 'encounter_attempt', {
    encounter_id: encounter.id, kind: 'skill_challenge', character_id: attempt.characterId,
    skill: attempt.skill, success: attempt.success, successes: next.successes, failures: next.failures,
    status,
  })

  // A successful attempt in a room holding authored evidence finds it (investigation pillar).
  const found = discoveryNote(
    await discoverAtLocation(service, env, sessionId, {
      locationId: state.scene.locationId,
      actorCharacterId: attempt.characterId,
      checkPassed: attempt.success,
    }),
  )

  const note = progressNote(next, encounter.label)
  if (status === 'ongoing') {
    await narrationBeat(
      service, env, sessionId,
      `Narrate this skill-challenge attempt. ${attempt.actorName} attempts: ${attempt.interpretation}. ` +
        `It ${attempt.success ? 'SUCCEEDS' : 'FAILS'} (${attempt.detail}). ${attempt.consequencesHint}${found} ` +
        `${note} The challenge is not over - keep the situation live and demanding the party's next move.`,
      'Challenge attempt',
      'outcome',
    )
    return status
  }
  await resolveOpenEncounter(
    service, env, sessionId, status as ResolutionTier,
    `The final attempt: ${attempt.actorName} - ${attempt.interpretation}, which ` +
      `${attempt.success ? 'succeeded' : 'failed'} (${attempt.detail}). ${note}${found}`,
  )
  return status
}
