// player_intent (F07 SS3): envelope in, deterministic route, then fast path (never an LLM),
// free chat, the Adjudicator flow, or the F10 say pipeline. dm_command covers direct overrides
// (F07 SS5.2) - currently the consistency fact base.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  classifyIntent, dmSettings, liveRng, promptDeadline, promptExpired, rollCheck,
  ASSIST_PROMPT_WINDOW_S, GROUP_PROMPT_WINDOW_S, SOLO_PROMPT_WINDOW_S,
} from '../_shared/play/index.ts'
import type { CheckSpec, IntentRoute, PendingPrompt } from '../_shared/play/index.ts'
import type { GameState, Json, PendingPromptState } from '../_shared/state/index.ts'
import { runAdjudicator } from './agents.ts'
import type { AgentEnv, SceneEffects } from './agents.ts'
import { narrationBeat } from './narration.ts'
import { handleSay } from './npc-dialogue.ts'
import { endEncounter, startSocial } from './social-staging.ts'
import { maybeSpawnEncounter } from './danger.ts'
import { discoverAtLocation, discoveryNote } from './discovery.ts'
import { handleCutsceneIntent } from './entry.ts'
import { runProgressDirector } from './director.ts'
import {
  handleChallengeIntent, handleEncounterTalk, openEncounterCommand, spawnInstantiator,
  specFromCommandBody,
} from './encounters.ts'
import { handlePuzzleIntent, openPuzzleFromSpec } from './puzzle-encounter.ts'
import { openSocialEncounter } from './social-encounter.ts'
import {
  activePcIds, agentContextLines, appendLinesDiff, characterProfiles, loadCharacter,
  loadPartyCharacters, loadPlayContext, newLine, partySkillList, pendingDiffs, skillModifierFor,
  typingDiff,
} from './orchestrate.ts'
import { classifyAndHandle, noteIntentForClassifier, planAndOpenBeat } from './beats.ts'
import {
  dueDeadlines, markMissed, parseDeadlineRecords, resolveAtomText,
} from '../_shared/story/index.ts'
import { milestoneVocabulary } from './milestones.ts'
import { applyNpcState } from './npc-state.ts'
import type { CharacterRow, PlayContext } from './orchestrate.ts'
import { evaluateStoryProgress } from './progress.ts'
import { resolvePending } from './prompts.ts'
import { expireStaleProposals, recordProposal } from './proposals.ts'
import { applySceneEffects } from './scene-director.ts'
import { completeQuest, journalPatch, maybeHandleOfferResponse, stageOfferByContractId } from './story.ts'
import { antagonistTurn, noteSuspicion } from './steward.ts'
import type { DoCheckStash, SayUtterance } from './stashes.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

const mustPickCharacter = { status: 403, body: { error: 'Pick a character before acting' } }

/**
 * A deadline the party agreed to and then blew through. Deliberately a CONSEQUENCE, not a loss:
 * the objective is not failed here. The Progress Director owns retiring objectives and it
 * retires them for being STUCK, which is a different thing from being LATE - a party that is
 * late but still trying should meet a world that has moved on, not a story that stopped.
 *
 * Fires once per deadline (markMissed), so a long game does not re-narrate the same broken
 * promise every dawn.
 */
async function spendDeadlines(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
): Promise<void> {
  try {
    const records = parseDeadlineRecords(state.dm?.story?.deadlines as Json)
    const due = dueDeadlines(records, state.scene.day)
    if (due.length === 0) return
    await commitDiffs(service, env.adventureId, () => [{
      domain: 'dm',
      patch: { story: { deadlines: markMissed(records, due.map((d) => d.contractId)) as unknown as Json } },
    }])
    for (const missed of due) {
      await logEvent(service, env.adventureId, sessionId, 'deadline_missed', {
        contract_id: missed.contractId, label: missed.label, due_day: missed.dueDay,
        day: state.scene.day,
      })
    }
    await narrationBeat(
      service, env, sessionId,
      `Time has run out on what the party promised: ${due.map((d) => d.label).join('; ')}. ` +
        `The deadline was day ${due[0].dueDay}; it is now day ${state.scene.day}. Narrate the ` +
        `cost of being late - who was counting on them, what has already happened without them, ` +
        `what the delay has cost. The party can still act; the world simply did not wait.`,
      'The clock runs out',
    )
  } catch (err) {
    // Pacing colour must never cost a player their day-advance.
    console.error('deadline pass failed', err)
  }
}

export async function playerIntent(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  body: Record<string, unknown>,
) {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value

  const kind = String(body.kind ?? '')
  const text = String(body.text ?? '').slice(0, 2000)
  const targetId = body.target_id ? String(body.target_id) : null
  const skill = body.skill ? String(body.skill) : null

  // Superseded-by-events rule (F07 SS4): stale pending proposals expire as play moves on.
  await expireStaleProposals(service, adventureId)

  if (kind === 'dm_command') return dmCommand(service, adventureId, play, body)

  if (!play.member?.character_id) return mustPickCharacter
  const character = await loadCharacter(service, play.member.character_id)
  if (!character) return mustPickCharacter

  if (row.state.dialogue.pending || row.state.dialogue.typing) {
    // An expired check sweeps itself on the next intent, whoever sends it. Every piece of this
    // already existed - prompts carry 15-20s deadlines, and resolvePending is a complete
    // sweeper (idle players auto-roll flat; an unclaimed enable-assist fails forward) - but the
    // only caller was a UI button, so a table whose players never pressed it fell through to
    // the 120s idle rule below and every intent 409'd until then. Live 2026-07-23: an assist
    // prompt nobody could answer rejected twelve consecutive turns with "Resolve the current
    // check first". The player's line is NOT processed on top of the sweep - the world just
    // moved (auto-rolls, possibly a fail-forward narration), so their input may no longer make
    // sense; they resend against the resolved scene.
    const pending = row.state.dialogue.pending
    if (pending && promptExpired(pending.deadline, new Date())) {
      const swept = await resolvePending(service, adventureId, userId, pending.id)
      if (swept.status === 200) {
        return { status: 409, body: { error: 'The moment resolved itself - go again', swept: true } }
      }
    }
    // Self-heal a dead pipeline: a worker killed mid-call (WORKER_RESOURCE_LIMIT, seen live)
    // never reaches its catch block, so typing:true - or a pending prompt orphaned after its
    // roll - would lock the table forever. If nothing has been logged for 2 minutes, the DM
    // is not thinking and no flow is coming back for the prompt: clear both and proceed.
    const { data: lastEvent } = await service
      .from('event_log')
      .select('created_at')
      .eq('adventure_id', adventureId)
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle()
    const lastAt = lastEvent ? new Date(lastEvent.created_at as string).getTime() : 0
    if (Date.now() - lastAt < 120_000) {
      return row.state.dialogue.pending
        ? { status: 409, body: { error: 'Resolve the current check first' } }
        : { status: 409, body: { error: 'The DM is thinking - one moment' } }
    }
    await commitDiffs(service, adventureId, () => [...pendingDiffs(null, null), typingDiff(false)])
  }
  // Slice 2 table lock: one gist review at a time; nothing else moves until the DM decides.
  if (row.state.dm?.pendingReview) {
    return { status: 409, body: { error: 'The DM is choosing a response - one moment' } }
  }

  // Open offer on the table (F08 SS2.1): free text runs the offer classifier before normal
  // routing - any PC's clear accept binds the party; 'unrelated' falls through untouched.
  if (kind === 'say' || kind === 'do') {
    const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
    const offerResult = await maybeHandleOfferResponse(service, env, play.sessionId, character, text)
    if (offerResult) return offerResult
  }

  // Phase enforcement (encounter-states Slice 3): narrative play is a two-phase machine.
  // An open encounter's handler owns actions; otherwise full-AI cutscenes route every say/do
  // through entry mapping - the free-form adjudication path no longer exists for them.
  // Assist keeps the human DM as the driver: only open challenges intercept its intents.
  let route: IntentRoute | 'challenge' | 'entry' | 'puzzle' | 'encounter_talk' = classifyIntent(
    { kind: kind as never, skill, targetId },
    { mode: row.state.scene.mode, stagedNpcIds: row.state.dialogue.speakers.map((s) => s.npcId) },
  )
  // Unified input (2026-07-20): the player just talks to the DM - say and do route
  // identically, and the interpreters decide what the words are (the social classifier
  // escapes physical actions out of conversations; the adjudicator's talk flag and the
  // puzzle judge's talk result turn questions into answered DM talk). Explicit Roll stays
  // the one mechanical fast path.
  const narrativeMode = ['narration', 'roleplay', 'downtime', 'puzzle'].includes(row.state.scene.mode)
  if (narrativeMode && (kind === 'say' || kind === 'do' || (kind === 'roll' && !skill))) {
    const conversational = row.state.dialogue.speakers.length > 0 && kind !== 'roll'
    // An open challenge/puzzle outranks a staged speaker (defense in depth behind the entry
    // mapper's staging guard): a leftover speaker used to swallow every input and starve the
    // encounter. Genuine questions still get answered - both handlers forward talk to
    // handleEncounterTalk.
    if (row.state.encounter?.kind === 'skill_challenge') {
      route = 'challenge'
    } else if (row.state.encounter?.kind === 'puzzle') {
      route = 'puzzle'
    } else if (conversational) {
      route = 'dialogue'
    } else if (row.state.encounter?.kind === 'social') {
      route = 'encounter_talk'
    } else if (play.adventure.mode === 'full_ai') {
      route = 'entry'
    }
    // Assist with nobody staged keeps classifyIntent's verdict (free adjudication).
  }
  // Variety/classifier bookkeeping wants the interpreted pillar, not the button pressed.
  const pillarKind = route === 'dialogue' || route === 'encounter_talk' || route === 'chat'
    ? 'say'
    : kind === 'roll' ? 'roll' : 'do'
  await logEvent(service, adventureId, play.sessionId, 'intent_submitted', {
    kind: pillarKind, raw_kind: kind, route, character_id: character.id, text: text.slice(0, 200),
  })
  // Watermark for the director: everything logged after this point belongs to THIS turn, so
  // "did the spine move?" is measured against the turn rather than a rolling event window.
  const { data: watermark } = await service
    .from('event_log')
    .select('id')
    .eq('adventure_id', adventureId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const directorSinceEventId = Number((watermark as { id?: number } | null)?.id ?? 0)

  let result: { status: number; body: Record<string, unknown> }
  switch (route) {
    case 'challenge': {
      const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
      result = await handleChallengeIntent(service, env, play.sessionId, character, text)
      break
    }
    case 'puzzle': {
      const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
      result = await handlePuzzleIntent(service, env, play.sessionId, character, text)
      break
    }
    case 'encounter_talk': {
      const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
      result = await handleEncounterTalk(service, env, play.sessionId, character, text)
      // Suspicion parity with the other say routes - never blocks the reply.
      if (result.status === 200) {
        try {
          await noteSuspicion(service, env, play.sessionId, text)
        } catch (err) {
          console.error('suspicion pass failed', err)
        }
      }
      break
    }
    case 'entry': {
      const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
      result = await handleCutsceneIntent(service, env, play.sessionId, character, text, kind)
      break
    }
    case 'fast_path':
      result = await fastPath(service, adventureId, play.sessionId, kind, skill, character)
      break
    case 'chat': {
      await commitDiffs(service, adventureId, (s) => [appendLinesDiff(s, [newLine(character.name, null, text)])])
      await logEvent(service, adventureId, play.sessionId, 'chat', { character_id: character.id, text })
      try {
        const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
        await noteSuspicion(service, env, play.sessionId, text)
      } catch (err) {
        console.error('suspicion pass failed', err)
      }
      result = { status: 200, body: { ok: true, resolved: 'chat' } }
      break
    }
    case 'dialogue': {
      const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
      const utterance: SayUtterance = { actorCharacterId: character.id, actorName: character.name, text }
      result = await handleSay(service, env, play.sessionId, utterance, targetId)
      // A question about the world, not to the NPC: answer it as grounded narration.
      if (result.status === 200 && result.body.resolved === 'ask_dm') {
        result = await handleEncounterTalk(service, env, play.sessionId, character, text, { lineAlreadyStaged: true })
        break
      }
      // The social classifier escaped a physical action out of the conversation (unified
      // input): the line is committed and typing is on - continue in the right action flow.
      if (result.status === 200 && result.body.resolved === 'action') {
        if (row.state.encounter?.kind === 'skill_challenge') {
          result = await handleChallengeIntent(service, env, play.sessionId, character, text, { lineAlreadyStaged: true })
        } else if (row.state.encounter?.kind === 'puzzle') {
          result = await handlePuzzleIntent(service, env, play.sessionId, character, text, { lineAlreadyStaged: true })
        } else if (play.adventure.mode === 'full_ai' && !row.state.encounter && narrativeMode) {
          result = await handleCutsceneIntent(service, env, play.sessionId, character, text, 'do', { lineAlreadyStaged: true })
        } else {
          result = await adjudicate(service, adventureId, play, character, text, { lineAlreadyStaged: true })
        }
      }
      break
    }
    case 'adjudicate':
      result = await adjudicate(service, adventureId, play, character, text)
      // Say-kind intents used to get suspicion tagging on the chat route; keep parity now
      // that no-NPC says adjudicate instead.
      if (kind === 'say' && result.status === 200) {
        try {
          const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
          await noteSuspicion(service, env, play.sessionId, text)
        } catch (err) {
          console.error('suspicion pass failed', err)
        }
      }
      break
    default:
      return { status: 400, body: { error: `Unroutable intent kind: ${kind}` } }
  }

  // Off-loop streak bookkeeping (F08 SS3) runs after the route resolves so a triggered
  // classifier pivot narrates after the action, never interleaved with it.
  if (result.status === 200) {
    const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
    // THE per-turn pacing pass (Phase 3). This hook is the only place every turn passes
    // through - evaluateStoryProgress fires only on encounter resolutions, fact writes and
    // scene effects, so a turn that folded into narration used to reach no detector at all.
    // Self-guarding (decideDirector holds unless the streak earned a rung) and never throws.
    if (env.mode === 'full_ai') {
      await runProgressDirector(service, env, play.sessionId, {
        sinceEventId: directorSinceEventId,
        countsAsTurn: kind !== 'dm_command',
      })
    }
    try {
      const classified = await noteIntentForClassifier(service, env, play.sessionId, pillarKind)
      if (classified?.body.resolved === 'pivoted') {
        const patch = await journalPatch(service, adventureId)
        await commitDiffs(service, adventureId, () => [patch])
      }
    } catch (err) {
      console.error('classifier pass failed', err)
    }
  }
  return result
}

/** Explicit rolls resolve engine-only - the usage_log assertion in the AI tests rides on this. */
async function fastPath(
  service: SupabaseClient,
  adventureId: string,
  sessionId: string,
  kind: string,
  skill: string | null,
  character: CharacterRow,
) {
  if (kind !== 'roll') {
    return { status: 409, body: { error: 'Combat actions arrive with the combat engine (Phase 7)' } }
  }
  const modifier = skillModifierFor(character, skill!)
  const result = rollCheck(liveRng(), modifier, 0, 'none')
  const sign = modifier >= 0 ? '+' : ''
  const line = newLine(null, null, `${character.name} rolls ${skill}: ${result.total} (d20 ${result.d20} ${sign}${modifier})`)
  await commitDiffs(service, adventureId, (s) => [appendLinesDiff(s, [line])])
  await logEvent(service, adventureId, sessionId, 'check_rolled', {
    character_id: character.id, skill, total: result.total, d20: result.d20, modifier, fast_path: true,
  })
  return { status: 200, body: { ok: true, resolved: 'rolled', total: result.total, d20: result.d20, modifier } }
}

async function adjudicate(
  service: SupabaseClient,
  adventureId: string,
  play: { adventure: { creator_id: string; mode: string | null }; sessionId: string; demo: boolean },
  character: CharacterRow,
  text: string,
  opts?: { lineAlreadyStaged?: boolean },
) {
  const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
  if (!opts?.lineAlreadyStaged) {
    await commitDiffs(service, adventureId, (s) => [
      appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
    ])
  }

  const [party, locationRows, npcRows] = await Promise.all([
    loadPartyCharacters(service, adventureId),
    service.from('locations').select('name').eq('adventure_id', adventureId),
    service.from('npcs').select('name').eq('adventure_id', adventureId),
  ])
  const partySkills = partySkillList(party)
  let adjudication
  try {
    const state = (await loadState(service, adventureId)).state
    // ONE vocabulary window for every producer and consumer (overhaul Phase 1). This used to
    // hand-build a NARROWER set (current objective + open beat only) than applyMilestones
    // would accept - the Adjudicator was shown fewer words than the gate honours, so lookahead
    // and past-beat atoms it could legitimately claim were never offered to it.
    const vocab = await milestoneVocabulary(service, adventureId)
    const profiles = await characterProfiles(service, party)
    adjudication = await runAdjudicator(env, {
      intentText: text,
      actorSummary: profiles[character.id] ?? `${character.name}, level ${character.level} ${character.class_key ?? 'adventurer'}`,
      sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode})`,
      objective: vocab.objective
        ? { title: vocab.objective.title, hiddenDescription: vocab.objective.hiddenDescription }
        : null,
      partySkills,
      partySize: party.length,
      recentEvents: agentContextLines(state, 5),
      knownLocations: ((locationRows.data ?? []) as { name: string }[]).map((l) => l.name),
      knownNpcs: ((npcRows.data ?? []) as { name: string }[]).map((n) => n.name),
      milestones: [...new Set([...vocab.flags, ...vocab.events, ...vocab.facts])],
    })
  } catch (err) {
    await commitDiffs(service, adventureId, () => [typingDiff(false)])
    throw err
  }

  await recordProposal(service, {
    adventureId,
    sessionId: play.sessionId,
    type: 'ruling',
    payload: adjudication as unknown as Json,
    mode: play.adventure.mode === 'assist' && adjudication.flags.needsDm ? 'human' : 'auto',
    blocking: true,
    summary: `${adjudication.resolution.type}: ${adjudication.interpretation.slice(0, 60)}`,
  })

  if (adjudication.flags.talk) {
    // A question to the DM, not an action (unified input): answer it in the fiction.
    return handleEncounterTalk(service, env, play.sessionId, character, text, { lineAlreadyStaged: true })
  }

  if (play.adventure.mode === 'assist' && adjudication.flags.needsDm) {
    // Assist short-circuit (F07 SS3.3): the ruling waits in the tray; Phase 10 makes it clickable.
    await commitDiffs(service, adventureId, () => [typingDiff(false)])
    return { status: 200, body: { ok: true, resolved: 'pending_dm' } }
  }

  const { resolution } = adjudication
  if (resolution.type !== 'check' || !resolution.check) {
    if (adjudication.flags.impossible) {
      await commitDiffs(service, adventureId, (s) => [
        appendLinesDiff(s, [newLine(null, null, `${adjudication.interpretation} - but that simply isn't possible here.`)], { typing: false }),
      ])
      return { status: 200, body: { ok: true, resolved: 'impossible' } }
    }
    const outcome = resolution.type === 'auto_success' ? 'succeeds without a roll' : 'fails - no roll could save it'
    // Scene Director v1: apply validated world movement BEFORE narrating, so the narrator and
    // consistency checker ground on the new scene instead of fighting the transition.
    const applyEffects =
      resolution.type === 'auto_success' && adjudication.sceneEffects && play.adventure.mode === 'full_ai'
    let sceneNote = ''
    if (applyEffects) {
      const applied = await applySceneEffects(
        service, env, play.sessionId, adjudication.sceneEffects!,
        {
          stageNpcs: (npcIds) => startSocial(service, adventureId, env.creatorId, npcIds),
          endScene: () => endEncounter(service, adventureId, env.creatorId),
        },
      )
      if (applied.sceneEnded) sceneNote += ' The conversation has ended; the party is on the move again.'
      if (applied.traveledTo) sceneNote += ` The party has just arrived at ${applied.traveledTo} - establish the new scene there.`
      if (applied.staged.length > 0) sceneNote += ` Present and in conversation now: ${applied.staged.join(', ')}.`
      if (applied.dayAdvanced !== null) sceneNote += ' Meaningful time passes during this - let the narration carry it.'
      if (applied.combatWon) sceneNote += ` A fight broke out ("${applied.combatWon}") and the party won decisively - narrate the clash and its immediate aftermath.`
    }
    // An auto-success in a room holding authored evidence finds it (investigation pillar).
    if (resolution.type === 'auto_success') {
      const scene = (await loadState(service, adventureId)).state.scene
      sceneNote += discoveryNote(
        await discoverAtLocation(service, env, play.sessionId, {
          locationId: scene.locationId,
          actorCharacterId: character.id,
          checkPassed: true,
        }),
      )
    }
    await narrationBeat(
      service, env, play.sessionId,
      `Narrate this action outcome. ${character.name} attempts: ${adjudication.interpretation}. It ${outcome}. ${resolution.consequencesHint}${sceneNote}`,
      'Action outcome',
      'outcome',
    )
    // Travel/marker effects may satisfy beat exits or objective predicates - let the story move.
    if (applyEffects) await evaluateStoryProgress(service, env, play.sessionId)
    return { status: 200, body: { ok: true, resolved: resolution.type } }
  }

  // A solo party has nobody to fill an assist slot - the prompt would just sit until expiry.
  const spec = party.length < 2 && resolution.check.requiresAssist
    ? { ...resolution.check, requiresAssist: null }
    : resolution.check
  const stash: DoCheckStash = {
    flow: 'do',
    utterance: text,
    actorCharacterId: character.id,
    actorName: character.name,
    interpretation: adjudication.interpretation,
    consequencesHint: resolution.consequencesHint,
    spec,
    assistResult: null,
    sceneEffects: play.adventure.mode === 'full_ai' ? adjudication.sceneEffects : null,
  }
  const prompt = buildPrompt(spec, character, await activePcIds(service, adventureId))
  await commitDiffs(service, adventureId, () => [...pendingDiffs(prompt, stash as unknown as Json), typingDiff(false)])
  await logEvent(service, adventureId, play.sessionId, 'check_prompted', {
    kind: prompt.kind, skill: spec.skill, group: spec.group, assist: spec.requiresAssist as unknown as Json,
  })
  return { status: 200, body: { ok: true, resolved: 'check_prompted', prompt: prompt as unknown as Json } }
}

function buildPrompt(spec: CheckSpec, actor: CharacterRow, partyCharacterIds: string[]): PendingPromptState {
  const now = new Date()
  if (spec.group) {
    const prompt: PendingPrompt = {
      kind: 'group',
      id: crypto.randomUUID(),
      skill: spec.skill,
      reason: spec.rationale,
      memberCharacterIds: partyCharacterIds.length > 0 ? partyCharacterIds : [actor.id],
      rolled: [],
      deadline: promptDeadline(now, GROUP_PROMPT_WINDOW_S),
    }
    return prompt as PendingPromptState
  }
  if (spec.requiresAssist) {
    const prompt: PendingPrompt = {
      kind: 'assist',
      id: crypto.randomUUID(),
      primaryCharacterId: actor.id,
      primarySkill: spec.skill,
      assistSkill: spec.requiresAssist.skill,
      effect: spec.requiresAssist.effect,
      reason: spec.rationale,
      deadline: promptDeadline(now, ASSIST_PROMPT_WINDOW_S),
    }
    return { ...prompt, skill: spec.requiresAssist.skill } as PendingPromptState
  }
  const prompt: PendingPrompt = {
    kind: 'check',
    id: crypto.randomUUID(),
    actorCharacterId: actor.id,
    skill: spec.skill,
    // The DM offers the applicable skills as buttons; the player picks which to roll.
    skillOptions: spec.skillOptions.length > 0 ? spec.skillOptions : [spec.skill],
    advDis: spec.advDis,
    reason: spec.rationale,
    deadline: promptDeadline(now, SOLO_PROMPT_WINDOW_S),
  }
  return prompt as PendingPromptState
}

/** F07 SS5.2 direct overrides: consistency facts, automation toggles, and F08 quest overrides. */
async function dmCommand(
  service: SupabaseClient,
  adventureId: string,
  play: PlayContext,
  body: Record<string, unknown>,
) {
  const { isDm, sessionId } = play
  if (!isDm) return { status: 403, body: { error: 'DM only' } }
  const command = String(body.command ?? '')
  const env: AgentEnv = {
    service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode,
  }
  if (command === 'stage_offer') {
    const contractId = String(body.contract_id ?? '')
    if (!contractId) return { status: 400, body: { error: 'contract_id required' } }
    return stageOfferByContractId(service, env, sessionId, contractId)
  }
  if (command === 'complete_quest') {
    const offerId = String(body.offer_id ?? '')
    if (!offerId) return { status: 400, body: { error: 'offer_id required' } }
    const result = await completeQuest(service, env, sessionId, offerId)
    if (result.status === 200) await evaluateStoryProgress(service, env, sessionId)
    return result
  }
  // F08 story overrides: world facts/flags/marker events feed the predicate evaluator; every
  // write triggers a story-progress pass (objectives, beat exits, ending scores).
  // set_flag/mark_event resolve through the atom authority (Phase 1): a typo'd or invented
  // name used to write dead state that could never satisfy a predicate - now it 400s with
  // suggestions. `force: true` keeps the human escape hatch, loudly logged.
  if (command === 'set_flag') {
    const flag = String(body.flag ?? '')
    if (!flag) return { status: 400, body: { error: 'flag required' } }
    const value = (body.value ?? true) as Json
    let resolved = flag
    if (body.force !== true) {
      const vocab = await milestoneVocabulary(service, adventureId)
      // Flags only: resolving a FACT atom here would "accept" the command yet write the flags
      // namespace, which a {fact:...} predicate never reads - set_fact is the fact override.
      const resolution = resolveAtomText(flag, vocab.flags)
      if (!resolution.ok) {
        const isFact = resolveAtomText(flag, vocab.facts).ok
        return {
          status: 400,
          body: {
            error: `"${flag}" is not an authored flag`,
            suggestions: resolution.suggestions,
            hint: isFact ? 'this atom is a FACT - use set_fact' : 'pass force: true to write it anyway',
          },
        }
      }
      resolved = resolution.text
    } else {
      await logEvent(service, adventureId, sessionId, 'atom_forced', { command, atom: flag })
    }
    await commitDiffs(service, adventureId, () => [
      { domain: 'dm', patch: { facts: { flags: { [resolved]: value } } } },
    ])
    await logEvent(service, adventureId, sessionId, 'dm_override', { command, flag: resolved, value })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true, flag: resolved } }
  }
  if (command === 'set_fact') {
    const fact = String(body.fact ?? '')
    if (!fact) return { status: 400, body: { error: 'fact required' } }
    const value = (body.value ?? true) as Json
    await commitDiffs(service, adventureId, () => [
      { domain: 'dm', patch: { facts: { world: { [fact]: value } } } },
    ])
    await logEvent(service, adventureId, sessionId, 'dm_override', { command, fact, value })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true } }
  }
  if (command === 'mark_event') {
    const tag = String(body.tag ?? '')
    if (!tag) return { status: 400, body: { error: 'tag required' } }
    let resolved = tag
    if (body.force !== true) {
      const vocab = await milestoneVocabulary(service, adventureId)
      const resolution = resolveAtomText(tag, vocab.events)
      if (!resolution.ok) {
        return {
          status: 400,
          body: { error: `"${tag}" is not an authored event marker`, suggestions: resolution.suggestions, hint: 'pass force: true to write it anyway' },
        }
      }
      resolved = resolution.text
    } else {
      await logEvent(service, adventureId, sessionId, 'atom_forced', { command, atom: tag })
    }
    await logEvent(service, adventureId, sessionId, 'story_event', { tag: resolved })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true, tag: resolved } }
  }
  // Encounter-states: hand-seed a typed encounter (testing surface + DM override).
  if (command === 'open_encounter') {
    if (String(body.encounter_kind ?? '') === 'puzzle') {
      const row = await loadState(service, adventureId)
      if (row.state.encounter) return { status: 409, body: { error: 'An encounter is already open' } }
      const label = String(body.label ?? '').trim()
      if (!label) return { status: 400, body: { error: 'label required' } }
      const encounter = await openPuzzleFromSpec(service, env, sessionId, {
        kind: 'puzzle',
        label,
        stakes: String(body.stakes ?? ''),
        params: {
          solution: String(body.solution ?? ''),
          steps: (Array.isArray(body.steps) ? body.steps : []) as Json,
          max_attempts: Number(body.max_attempts ?? 3),
          fail_consequence: (body.fail_consequence ?? { kind: 'antagonist_step', params: {} }) as Json,
        },
        onSuccess: Array.isArray(body.on_success) ? body.on_success.filter((s): s is string => typeof s === 'string') : [],
        onPartial: Array.isArray(body.on_partial) ? body.on_partial.filter((s): s is string => typeof s === 'string') : [],
        onFailure: Array.isArray(body.on_failure) ? body.on_failure.filter((s): s is string => typeof s === 'string') : [],
      })
      return { status: 200, body: { ok: true, encounter_id: encounter.id, kind: 'puzzle', label } }
    }
    if (String(body.encounter_kind ?? '') === 'social') {
      const row = await loadState(service, adventureId)
      if (row.state.encounter) return { status: 409, body: { error: 'An encounter is already open' } }
      const spec = specFromCommandBody('social', body)
      if (!spec.label) return { status: 400, body: { error: 'label required' } }
      const encounter = await openSocialEncounter(
        service, env, sessionId, spec,
        (npcIds) => startSocial(service, adventureId, env.creatorId, npcIds),
      )
      if (!encounter) return { status: 400, body: { error: 'No stageable NPCs for the social encounter' } }
      return { status: 200, body: { ok: true, encounter_id: encounter.id, kind: 'social', label: spec.label } }
    }
    return openEncounterCommand(service, env, sessionId, body)
  }
  if (command === 'plan_beat') {
    const { data: loops } = await service
      .from('core_loops')
      .select('id')
      .eq('adventure_id', adventureId)
      .eq('status', 'active')
      .limit(1)
    const loopId = (loops ?? [])[0]?.id as string | undefined
    if (!loopId) return { status: 409, body: { error: 'No active loop - accept a quest first' } }
    return planAndOpenBeat(service, env, sessionId, loopId, 'dm_command')
  }
  if (command === 'reclassify') {
    const result = await classifyAndHandle(service, env, sessionId)
    if (result.body.resolved === 'pivoted') {
      const patch = await journalPatch(service, adventureId)
      await commitDiffs(service, adventureId, () => [patch])
    }
    return result
  }
  if (command === 'advance_day') {
    const after = await commitDiffs(service, adventureId, (s) => [
      { domain: 'scene', patch: { day: s.scene.day + 1 } },
    ])
    await logEvent(service, adventureId, sessionId, 'day_advanced', { day: after.state.scene.day })
    await spendDeadlines(service, env, sessionId, after.state)
    await antagonistTurn(service, env, sessionId, 'world_clock')
    await evaluateStoryProgress(service, env, sessionId)
    // Transition point (Slice 6): passing time invites the world in.
    await maybeSpawnEncounter(service, env, sessionId, 'advance_day', spawnInstantiator(service, env, sessionId))
    return { status: 200, body: { ok: true, day: after.state.scene.day } }
  }
  if (command === 'set_auto') {
    const patch: Record<string, boolean | number | Json> = {}
    if (typeof body.auto_dialogue === 'boolean') patch.autoDialogue = body.auto_dialogue
    if (typeof body.auto_checks === 'boolean') patch.autoChecks = body.auto_checks
    if (typeof body.nudge_minutes === 'number' && body.nudge_minutes >= 1) {
      patch.nudgeMinutes = Math.min(60, Math.round(body.nudge_minutes))
    }
    if (typeof body.hint_turns === 'number' && body.hint_turns >= 1) {
      patch.hintTurns = Math.min(20, Math.round(body.hint_turns))
    }
    // Progress Director thresholds (Phase 3/4). DM-tunable per MAIN-SPEC - a table that wants
    // to be left alone raises them, and a test run lowers them to reach the rescue rungs
    // without playing 15 stalled turns. Each field is independently optional.
    if (typeof body.director_thresholds === 'object' && body.director_thresholds !== null) {
      const raw = body.director_thresholds as Record<string, unknown>
      const clamp = (v: unknown) =>
        typeof v === 'number' && v >= 1 ? Math.min(60, Math.round(v)) : undefined
      const thresholds: Record<string, number> = {}
      for (const key of ['nudge', 'reveal', 'replanBeat', 'guaranteedRoute', 'failForward', 'offerPressure']) {
        const value = clamp(raw[key])
        if (value !== undefined) thresholds[key] = value
      }
      if (Object.keys(thresholds).length > 0) patch.directorThresholds = thresholds as unknown as Json
    }
    if (Object.keys(patch).length === 0) {
      return { status: 400, body: { error: 'auto_dialogue, auto_checks, nudge_minutes, hint_turns, or director_thresholds required' } }
    }
    // Always write the full settings object so partial pre-Slice-2 states heal to a complete shape.
    const after = await commitDiffs(service, adventureId, (s) => [
      { domain: 'dm', patch: { settings: { ...dmSettings(s), ...patch } as unknown as Json } },
    ])
    await logEvent(service, adventureId, sessionId, 'dm_override', { command, ...patch })
    return { status: 200, body: { ok: true, settings: after.state.dm?.settings as unknown as Json } }
  }
  if (command === 'set_npc_state') {
    const npcId = String(body.npc_id ?? '')
    const state = String(body.state ?? '')
    if (!npcId || !['dead', 'alive', 'absent'].includes(state)) {
      return { status: 400, body: { error: 'npc_id and state (dead|alive|absent) required' } }
    }
    const { data: npcRow } = await service
      .from('npcs')
      .select('id, name')
      .eq('id', npcId)
      .maybeSingle()
    if (!npcRow) return { status: 404, body: { error: 'No such NPC' } }
    // Same single writer as the ledger: a DM-declared death also leaves the body in the world.
    await applyNpcState(
      service, env, sessionId,
      { id: npcRow.id as string, name: npcRow.name as string },
      state as 'dead' | 'alive' | 'absent',
      'dm_override',
    )
    await logEvent(service, adventureId, sessionId, 'dm_override', { command, npc_id: npcId, state })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true } }
  }
  return { status: 400, body: { error: `Unknown dm_command: ${command}` } }
}
