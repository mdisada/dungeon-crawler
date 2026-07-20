// Pending-prompt lifecycle (F07 SS3.4): actors roll their solo/group prompts, other PCs claim
// assist slots, and anyone may sweep an expired prompt (client timers call resolve_pending -
// edge functions have no timers of their own). Server rolls every die.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  applyAssist, checkGateActive, dmSettings, groupOutcome, liveRng, promptDeadline, promptExpired,
  rollCheck, SOLO_PROMPT_WINDOW_S,
} from '../_shared/play/index.ts'
import type { CheckResult } from '../_shared/play/index.ts'
import type { GameState, Json, PendingPromptState, PendingReviewState } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import type { ChallengeCheckStash } from './encounters.ts'
import type { DoCheckStash } from './intent.ts'
import { continueAfterCheck } from './npc-dialogue.ts'
import type { SocialCheckStash } from './npc-dialogue.ts'
import { narrationBeat } from './narration.ts'
import {
  appendLinesDiff, loadCharacter, loadPlayContext, newLine, pendingDiffs, skillModifierFor,
  typingDiff,
} from './orchestrate.ts'
import type { NegotiateStash } from './story.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

type Stash = DoCheckStash | SocialCheckStash | NegotiateStash | ChallengeCheckStash

function currentPrompt(state: GameState, promptId: string): PendingPromptState | null {
  const pending = state.dialogue.pending
  return pending && pending.id === promptId ? pending : null
}

function currentStash(state: GameState): Stash | null {
  return (state.dm?.conversation.pendingContext as Stash | null) ?? null
}

/**
 * The table sees every die (2026-07-20 playtest): a transcript line per rolled check -
 * "Kestrel rolls investigation: 7 (d20 5 +2) - failure". The DC stays the DM's secret.
 */
function rollLine(
  name: string,
  skill: string,
  result: CheckResult,
  advDis?: 'none' | 'advantage' | 'disadvantage',
  suffix = '',
) {
  const sign = result.modifier >= 0 ? '+' : ''
  const adv = advDis === 'advantage' ? ', advantage' : advDis === 'disadvantage' ? ', disadvantage' : ''
  return newLine(
    null, null,
    `${name} rolls ${skill}: ${result.total} (d20 ${result.d20} ${sign}${result.modifier}${adv})${suffix} - ` +
      `${result.success ? 'success' : 'failure'}`,
  )
}

/**
 * Slice 4 check gate: with auto-checks off the rolled outcome pauses as a DM ruling
 * (accept/flip) before consequences generate. The stash stays in pendingContext so
 * review_decide can resume the flow; the prompt itself clears (the die is cast).
 */
async function resolveOutcome(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  stash: Stash,
  result: CheckResult & { skill: string },
  detail: string,
): Promise<void> {
  const state = (await loadState(service, env.adventureId)).state
  if (checkGateActive({ mode: env.mode, autoChecks: dmSettings(state).autoChecks })) {
    const ruling: PendingReviewState = {
      id: crypto.randomUUID(),
      kind: 'check_ruling',
      actorName: stash.flow === 'do' || stash.flow === 'challenge' ? stash.actorName : stash.utterance.actorName,
      skill: result.skill,
      total: result.total,
      dc: result.dc,
      success: result.success,
      margin: result.margin,
      detail,
      createdAt: new Date().toISOString(),
    }
    await commitDiffs(service, env.adventureId, () => [
      { domain: 'dialogue', patch: { pending: null, typing: false } },
      { domain: 'dm', patch: { pendingReview: ruling as unknown as Json } },
    ])
    await logEvent(service, env.adventureId, sessionId, 'ruling_staged', {
      review_id: ruling.id, skill: result.skill, success: result.success, detail,
    })
    return
  }
  try {
    await continueAfterCheck(service, env, sessionId, stash, result, detail)
  } catch (err) {
    // An agent failure here must not leave typing:true locking every future intent.
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    throw err
  }
}

/**
 * The prompted actor (or a group member) rolls. Server-side dice, server-side modifiers.
 * `chosenSkill` picks among the prompt's offered skillOptions ("Does Investigation apply?"
 * "Sure!") - anything outside the offer falls back to the prompt's primary skill.
 */
export async function rollPending(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  promptId: string,
  chosenSkill?: string,
) {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value
  const prompt = currentPrompt(row.state, promptId)
  const stash = currentStash(row.state)
  if (!prompt || !stash) return { status: 404, body: { error: 'No such pending check' } }
  if (!play.member?.character_id) return { status: 403, body: { error: 'Pick a character first' } }
  const character = await loadCharacter(service, play.member.character_id)
  if (!character) return { status: 403, body: { error: 'Character not found' } }
  const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }

  if (prompt.kind === 'check') {
    if (prompt.actorCharacterId !== character.id) {
      return { status: 403, body: { error: 'This check belongs to another player' } }
    }
    const offered = prompt.skillOptions?.length ? prompt.skillOptions : [prompt.skill]
    const skill = chosenSkill && offered.some((s) => s.toLowerCase() === chosenSkill.toLowerCase())
      ? chosenSkill.toLowerCase()
      : prompt.skill
    const dc = stash.flow === 'challenge'
      ? (stash.dcBySkill?.[skill] ?? stash.dc)
      : stash.flow === 'do' ? stash.spec.dc : stash.dc
    const modifier = skillModifierFor(character, skill)
    const result = rollCheck(liveRng(), modifier, dc, prompt.advDis ?? 'none')
    await logEvent(service, adventureId, play.sessionId, 'check_rolled', {
      character_id: character.id, skill, total: result.total, dc, success: result.success,
      ...(skill !== prompt.skill ? { picked_from: offered as unknown as Json } : {}),
    })
    await commitDiffs(service, adventureId, (s) => [
      appendLinesDiff(s, [rollLine(character.name, skill, result, prompt.advDis)]),
    ])
    await resolveOutcome(service, env, play.sessionId, stash, { ...result, skill }, `${result.total} vs DC ${dc}`)
    return { status: 200, body: { ok: true, total: result.total, success: result.success, skill } }
  }
  const dc = stash.flow === 'do' ? stash.spec.dc : stash.dc

  if (prompt.kind === 'group') {
    if (!(prompt.memberCharacterIds ?? []).includes(character.id)) {
      return { status: 403, body: { error: 'You are not part of this group check' } }
    }
    if ((prompt.rolled ?? []).some((r) => r.characterId === character.id)) {
      return { status: 409, body: { error: 'You already rolled' } }
    }
    const modifier = skillModifierFor(character, prompt.skill)
    const result = rollCheck(liveRng(), modifier, dc, 'none')
    const rolled = [...(prompt.rolled ?? []), { characterId: character.id, total: result.total, success: result.success }]
    await logEvent(service, adventureId, play.sessionId, 'check_rolled', {
      character_id: character.id, skill: prompt.skill, total: result.total, dc, success: result.success, group: true,
    })
    await commitDiffs(service, adventureId, (s) => [
      appendLinesDiff(s, [rollLine(character.name, prompt.skill, result)]),
    ])
    if (rolled.length < (prompt.memberCharacterIds ?? []).length) {
      await commitDiffs(service, adventureId, () => [
        { domain: 'dialogue', patch: { pending: { ...prompt, rolled } as unknown as Json } },
      ])
      return { status: 200, body: { ok: true, total: result.total, waiting: true } }
    }
    await finishGroup(service, env, play.sessionId, stash, prompt, rolled)
    return { status: 200, body: { ok: true, total: result.total, waiting: false } }
  }

  return { status: 400, body: { error: 'Assist slots are claimed, not rolled (claim_assist)' } }
}

async function finishGroup(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  stash: Stash,
  prompt: PendingPromptState,
  rolled: { characterId: string; total: number; success: boolean }[],
): Promise<void> {
  const outcome = groupOutcome(rolled)
  await logEvent(service, env.adventureId, sessionId, 'group_check_resolved', {
    skill: prompt.skill, passes: outcome.passes, needed: outcome.needed, success: outcome.success,
  })
  const best = rolled.reduce((a, b) => (b.total > a.total ? b : a), rolled[0])
  await resolveOutcome(
    service, env, sessionId, stash,
    { rolls: [], d20: 0, modifier: 0, total: best.total, dc: 0, success: outcome.success, margin: outcome.success ? 1 : -1, skill: prompt.skill },
    `group: ${outcome.passes}/${rolled.length} passed, needed ${outcome.needed}`,
  )
}

/** A second PC commits to an open assist slot (F07 SS3.4); server rolls the assist at once. */
export async function claimAssist(service: SupabaseClient, adventureId: string, userId: string, promptId: string) {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value
  const prompt = currentPrompt(row.state, promptId)
  const stash = currentStash(row.state)
  if (!prompt || prompt.kind !== 'assist' || !stash || stash.flow !== 'do') {
    return { status: 404, body: { error: 'No open assist slot' } }
  }
  if (!play.member?.character_id) return { status: 403, body: { error: 'Pick a character first' } }
  const character = await loadCharacter(service, play.member.character_id)
  if (!character) return { status: 403, body: { error: 'Character not found' } }
  if (character.id === prompt.primaryCharacterId) {
    return { status: 403, body: { error: 'You cannot assist your own attempt' } }
  }

  const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
  const modifier = skillModifierFor(character, prompt.skill)
  const assist = rollCheck(liveRng(), modifier, stash.spec.dc, 'none')
  await logEvent(service, adventureId, play.sessionId, 'assist_claimed', {
    by: character.id, for: prompt.primaryCharacterId, skill: prompt.skill,
    effect: prompt.effect, total: assist.total, success: assist.success,
  })
  await commitDiffs(service, adventureId, (s) => [
    appendLinesDiff(s, [rollLine(character.name, `${prompt.skill} (assist)`, assist)]),
  ])

  const { mayAttempt, primaryAdvDis } = applyAssist(prompt.effect ?? 'bonus', assist)
  if (!mayAttempt) {
    await commitDiffs(service, adventureId, () => [...pendingDiffs(null, null), typingDiff(true)])
    await narrationBeat(
      service, env, play.sessionId,
      `Narrate a fail-forward: ${character.name}'s ${prompt.skill} assist for ${stash.actorName} fails, ` +
        `so the attempt (${stash.interpretation}) never gets its chance. ${stash.consequencesHint}`,
      'Action outcome',
      'outcome',
    )
    return { status: 200, body: { ok: true, assist_success: false, resolved: 'fail_forward' } }
  }

  const nextPrompt: PendingPromptState = {
    kind: 'check',
    id: crypto.randomUUID(),
    actorCharacterId: prompt.primaryCharacterId ?? stash.actorCharacterId,
    skill: prompt.primarySkill ?? stash.spec.skill,
    advDis: primaryAdvDis,
    reason: `${stash.spec.rationale}${assist.success ? ` (assisted by ${character.name})` : ''}`,
    deadline: promptDeadline(new Date(), SOLO_PROMPT_WINDOW_S),
  }
  const nextStash: DoCheckStash = { ...stash, assistResult: { success: assist.success, margin: assist.margin } }
  await commitDiffs(service, adventureId, () => pendingDiffs(nextPrompt, nextStash as unknown as Json))
  return { status: 200, body: { ok: true, assist_success: assist.success, resolved: 'primary_prompted' } }
}

/** Deadline sweeper: any member may call once the window lapses (idle players auto-roll flat). */
export async function resolvePending(service: SupabaseClient, adventureId: string, userId: string, promptId: string) {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value
  const prompt = currentPrompt(row.state, promptId)
  const stash = currentStash(row.state)
  if (!prompt || !stash) return { status: 404, body: { error: 'No such pending check' } }
  if (!promptExpired(prompt.deadline, new Date())) {
    return { status: 409, body: { error: 'Prompt has not expired yet' } }
  }
  const env: AgentEnv = { service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode }
  const dc = stash.flow === 'do' ? stash.spec.dc : stash.dc

  if (prompt.kind === 'check') {
    const actor = await loadCharacter(service, prompt.actorCharacterId ?? '')
    const modifier = actor ? skillModifierFor(actor, prompt.skill) : 0
    const result = rollCheck(liveRng(), modifier, dc, 'none')
    await logEvent(service, adventureId, play.sessionId, 'check_rolled', {
      character_id: prompt.actorCharacterId, skill: prompt.skill, total: result.total, dc,
      success: result.success, auto: true,
    })
    await commitDiffs(service, adventureId, (s) => [
      appendLinesDiff(s, [rollLine(actor?.name ?? 'Someone', prompt.skill, result, 'none', ' (auto)')]),
    ])
    await resolveOutcome(service, env, play.sessionId, stash, { ...result, skill: prompt.skill }, `${result.total} vs DC ${dc}, auto-rolled`)
    return { status: 200, body: { ok: true, resolved: 'auto_rolled' } }
  }

  if (prompt.kind === 'group') {
    const rolled = [...(prompt.rolled ?? [])]
    for (const characterId of prompt.memberCharacterIds ?? []) {
      if (rolled.some((r) => r.characterId === characterId)) continue
      const idle = await loadCharacter(service, characterId)
      const modifier = idle ? skillModifierFor(idle, prompt.skill) : 0
      const result = rollCheck(liveRng(), modifier, dc, 'none')
      rolled.push({ characterId, total: result.total, success: result.success })
      await logEvent(service, adventureId, play.sessionId, 'check_rolled', {
        character_id: characterId, skill: prompt.skill, total: result.total, dc, success: result.success,
        group: true, auto: true,
      })
      await commitDiffs(service, adventureId, (s) => [
        appendLinesDiff(s, [rollLine(idle?.name ?? 'Someone', prompt.skill, result, 'none', ' (auto)')]),
      ])
    }
    await finishGroup(service, env, play.sessionId, stash, prompt, rolled)
    return { status: 200, body: { ok: true, resolved: 'group_auto_completed' } }
  }

  // Unclaimed assist slot (F07 SS3.4): enable-gated fails forward, bonus proceeds unassisted.
  await logEvent(service, adventureId, play.sessionId, 'assist_expired', { skill: prompt.skill, effect: prompt.effect })
  if (stash.flow !== 'do') return { status: 500, body: { error: 'assist stash corrupted' } }
  if (prompt.effect === 'enable') {
    await commitDiffs(service, adventureId, () => [...pendingDiffs(null, null), typingDiff(true)])
    await narrationBeat(
      service, env, play.sessionId,
      `Narrate a fail-forward: nobody stepped in to help, so ${stash.actorName}'s attempt ` +
        `(${stash.interpretation}) cannot proceed as planned. ${stash.consequencesHint}`,
      'Action outcome',
      'outcome',
    )
    return { status: 200, body: { ok: true, resolved: 'fail_forward' } }
  }
  const nextPrompt: PendingPromptState = {
    kind: 'check',
    id: crypto.randomUUID(),
    actorCharacterId: prompt.primaryCharacterId ?? stash.actorCharacterId,
    skill: prompt.primarySkill ?? stash.spec.skill,
    advDis: 'none',
    reason: `${stash.spec.rationale} (unassisted)`,
    deadline: promptDeadline(new Date(), SOLO_PROMPT_WINDOW_S),
  }
  await commitDiffs(service, adventureId, () => pendingDiffs(nextPrompt, stash as unknown as Json))
  return { status: 200, body: { ok: true, resolved: 'primary_prompted_unassisted' } }
}
