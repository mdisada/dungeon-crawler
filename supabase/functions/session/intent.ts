// player_intent (F07 SS3): envelope in, deterministic route, then fast path (never an LLM),
// free chat, the Adjudicator flow, or the F10 say pipeline. dm_command covers direct overrides
// (F07 SS5.2) - currently the consistency fact base.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  classifyIntent, dmSettings, liveRng, promptDeadline, rollCheck,
  ASSIST_PROMPT_WINDOW_S, GROUP_PROMPT_WINDOW_S, SOLO_PROMPT_WINDOW_S,
} from '../_shared/play/index.ts'
import type { CheckSpec, PendingPrompt } from '../_shared/play/index.ts'
import type { Json, PendingPromptState } from '../_shared/state/index.ts'
import { runAdjudicator } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { narrationBeat } from './narration.ts'
import { handleSay } from './npc-dialogue.ts'
import type { SayUtterance } from './npc-dialogue.ts'
import {
  appendLinesDiff, loadCharacter, loadPartyCharacters, loadPlayContext, newLine,
  partySkillList, pendingDiffs, skillModifierFor, typingDiff,
} from './orchestrate.ts'
import { classifyAndHandle, noteIntentForClassifier, planAndOpenBeat } from './beats.ts'
import type { CharacterRow, PlayContext } from './orchestrate.ts'
import { evaluateStoryProgress } from './progress.ts'
import { expireStaleProposals, recordProposal } from './proposals.ts'
import { completeQuest, journalPatch, maybeHandleOfferResponse, stageOfferByContractId } from './story.ts'
import { antagonistTurn, noteSuspicion } from './steward.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

export interface DoCheckStash {
  flow: 'do'
  utterance: string
  actorCharacterId: string
  actorName: string
  interpretation: string
  consequencesHint: string
  spec: CheckSpec
  assistResult: { success: boolean; margin: number } | null
}

const mustPickCharacter = { status: 403, body: { error: 'Pick a character before acting' } }

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

  if (row.state.dialogue.pending) {
    return { status: 409, body: { error: 'Resolve the current check first' } }
  }
  if (row.state.dialogue.typing) {
    return { status: 409, body: { error: 'The DM is thinking - one moment' } }
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

  const route = classifyIntent(
    { kind: kind as never, skill, targetId },
    { mode: row.state.scene.mode, stagedNpcIds: row.state.dialogue.speakers.map((s) => s.npcId) },
  )
  await logEvent(service, adventureId, play.sessionId, 'intent_submitted', {
    kind, route, character_id: character.id, text: text.slice(0, 200),
  })

  let result: { status: number; body: Record<string, unknown> }
  switch (route) {
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
      break
    }
    case 'adjudicate':
      result = await adjudicate(service, adventureId, play, character, text)
      break
    default:
      return { status: 400, body: { error: `Unroutable intent kind: ${kind}` } }
  }

  // Off-loop streak bookkeeping (F08 SS3) runs after the route resolves so a triggered
  // classifier pivot narrates after the action, never interleaved with it.
  if (result.status === 200) {
    const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
    try {
      const classified = await noteIntentForClassifier(service, env, play.sessionId, kind)
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
) {
  const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
  await commitDiffs(service, adventureId, (s) => [
    appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
  ])

  const party = await loadPartyCharacters(service, adventureId)
  const partySkills = partySkillList(party)
  let adjudication
  try {
    const state = (await loadState(service, adventureId)).state
    const currentObjective = state.objectives.list.find((o) => o.id === state.objectives.currentId)
    const { data: objectiveRow } = currentObjective
      ? await service.from('objectives').select('title, hidden_description').eq('id', currentObjective.id).maybeSingle()
      : { data: null }
    adjudication = await runAdjudicator(env, {
      intentText: text,
      actorSummary: `${character.name}, level ${character.level} ${character.class_key ?? 'adventurer'}`,
      sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode})`,
      objective: objectiveRow
        ? { title: objectiveRow.title as string, hiddenDescription: objectiveRow.hidden_description as string }
        : null,
      partySkills,
      partySize: party.length,
      recentEvents: state.dialogue.lines.slice(-5).map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`),
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
    await narrationBeat(
      service, env, play.sessionId,
      `Narrate this action outcome. ${character.name} attempts: ${adjudication.interpretation}. It ${outcome}. ${resolution.consequencesHint}`,
      'Action outcome',
    )
    return { status: 200, body: { ok: true, resolved: resolution.type } }
  }

  const spec = resolution.check
  const stash: DoCheckStash = {
    flow: 'do',
    utterance: text,
    actorCharacterId: character.id,
    actorName: character.name,
    interpretation: adjudication.interpretation,
    consequencesHint: resolution.consequencesHint,
    spec,
    assistResult: null,
  }
  const prompt = buildPrompt(spec, character, await activePcIds(service, adventureId))
  await commitDiffs(service, adventureId, () => [...pendingDiffs(prompt, stash as unknown as Json), typingDiff(false)])
  await logEvent(service, adventureId, play.sessionId, 'check_prompted', {
    kind: prompt.kind, skill: spec.skill, group: spec.group, assist: spec.requiresAssist as unknown as Json,
  })
  return { status: 200, body: { ok: true, resolved: 'check_prompted', prompt: prompt as unknown as Json } }
}

async function activePcIds(service: SupabaseClient, adventureId: string): Promise<string[]> {
  const { data, error } = await service
    .from('adventure_members')
    .select('character_id, spectator, role')
    .eq('adventure_id', adventureId)
  assertOk(error, 'members load failed')
  return (data ?? [])
    .filter((m) => m.role === 'player' && !m.spectator && m.character_id)
    .map((m) => m.character_id as string)
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
  if (command === 'set_flag') {
    const flag = String(body.flag ?? '')
    if (!flag) return { status: 400, body: { error: 'flag required' } }
    const value = (body.value ?? true) as Json
    await commitDiffs(service, adventureId, () => [
      { domain: 'dm', patch: { facts: { flags: { [flag]: value } } } },
    ])
    await logEvent(service, adventureId, sessionId, 'dm_override', { command, flag, value })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true } }
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
    await logEvent(service, adventureId, sessionId, 'story_event', { tag })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true } }
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
    await antagonistTurn(service, env, sessionId, 'world_clock')
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true, day: after.state.scene.day } }
  }
  if (command === 'set_auto') {
    const patch: Record<string, boolean | number> = {}
    if (typeof body.auto_dialogue === 'boolean') patch.autoDialogue = body.auto_dialogue
    if (typeof body.auto_checks === 'boolean') patch.autoChecks = body.auto_checks
    if (typeof body.nudge_minutes === 'number' && body.nudge_minutes >= 1) {
      patch.nudgeMinutes = Math.min(60, Math.round(body.nudge_minutes))
    }
    if (Object.keys(patch).length === 0) {
      return { status: 400, body: { error: 'auto_dialogue, auto_checks, or nudge_minutes required' } }
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
    await commitDiffs(service, adventureId, () => [
      { domain: 'dm', patch: { facts: { npcStates: { [npcId]: state } } } },
    ])
    await logEvent(service, adventureId, sessionId, 'dm_override', { command, npc_id: npcId, state })
    await evaluateStoryProgress(service, env, sessionId)
    return { status: 200, body: { ok: true } }
  }
  return { status: 400, body: { error: `Unknown dm_command: ${command}` } }
}
