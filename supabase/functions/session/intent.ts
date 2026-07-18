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
import type { CharacterRow } from './orchestrate.ts'
import { expireStaleProposals, recordProposal } from './proposals.ts'
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

  if (kind === 'dm_command') return dmCommand(service, adventureId, play.isDm, play.sessionId, body)

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

  const route = classifyIntent(
    { kind: kind as never, skill, targetId },
    { mode: row.state.scene.mode, stagedNpcIds: row.state.dialogue.speakers.map((s) => s.npcId) },
  )
  await logEvent(service, adventureId, play.sessionId, 'intent_submitted', {
    kind, route, character_id: character.id, text: text.slice(0, 200),
  })

  switch (route) {
    case 'fast_path':
      return fastPath(service, adventureId, play.sessionId, kind, skill, character)
    case 'chat': {
      await commitDiffs(service, adventureId, (s) => [appendLinesDiff(s, [newLine(character.name, null, text)])])
      await logEvent(service, adventureId, play.sessionId, 'chat', { character_id: character.id, text })
      return { status: 200, body: { ok: true, resolved: 'chat' } }
    }
    case 'dialogue': {
      const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
      const utterance: SayUtterance = { actorCharacterId: character.id, actorName: character.name, text }
      return handleSay(service, env, play.sessionId, utterance, targetId)
    }
    case 'adjudicate':
      return adjudicate(service, adventureId, play, character, text)
    default:
      return { status: 400, body: { error: `Unroutable intent kind: ${kind}` } }
  }
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

/** F07 SS5.2 direct overrides. v1: the consistency fact base (npc dead/alive/absent). */
async function dmCommand(
  service: SupabaseClient,
  adventureId: string,
  isDm: boolean,
  sessionId: string,
  body: Record<string, unknown>,
) {
  if (!isDm) return { status: 403, body: { error: 'DM only' } }
  const command = String(body.command ?? '')
  if (command === 'set_auto') {
    const patch: Record<string, boolean> = {}
    if (typeof body.auto_dialogue === 'boolean') patch.autoDialogue = body.auto_dialogue
    if (typeof body.auto_checks === 'boolean') patch.autoChecks = body.auto_checks
    if (Object.keys(patch).length === 0) {
      return { status: 400, body: { error: 'auto_dialogue or auto_checks (boolean) required' } }
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
    return { status: 200, body: { ok: true } }
  }
  return { status: 400, body: { error: `Unknown dm_command: ${command}` } }
}
