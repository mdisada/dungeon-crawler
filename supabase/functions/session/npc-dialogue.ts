// The F10 say pipeline: classify the utterance -> optional check -> NPC Agent -> server-side
// reveal gating -> one commit. The NPC Agent proposes; the guardrails in _shared/play decide.
// Staging lives in social-staging.ts, dispositions in disposition.ts, the DM review gate in
// dm-review.ts - this module is the conversation itself.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  actionAutoAllowed, canConsumeOpening, dialogueGateActive, dmSettings,
  effectiveDispositionDelta, filterReveals, openingDcMod, promptDeadline, socialDc,
  SOLO_PROMPT_WINDOW_S,
} from '../_shared/play/index.ts'
import type { CheckResult, OpeningView, RevealCandidate } from '../_shared/play/index.ts'
import type { GameState, Json, OpeningState, PendingReviewState, StateDiff } from '../_shared/state/index.ts'
import { runConsistency, runNpcAgent, runReplyGists, runSocialClassifier } from './agents.ts'
import type { AgentEnv, NpcContext } from './agents.ts'
import { activeLoop } from '../_shared/story/index.ts'
import { loadLoops } from './beats.ts'
import { discoverAtLocation, discoveryNote } from './discovery.ts'
import { challengeCheckResolved } from './encounters.ts'
import { directedNarrationPrompt, narrationBeat, publishNarration, stageNarrationReview } from './narration.ts'
import {
  appendLinesDiff, loadPartyCharacters, newLine, partyProfileLines, pcLineCounts, pendingDiffs,
  typingDiff,
} from './orchestrate.ts'
import { retrieveMemories } from './memory.ts'
import { evaluateStoryProgress } from './progress.ts'
import { recordProposal } from './proposals.ts'
import { applySceneEffects } from './scene-director.ts'
import { detectSocialExit, recordSocialExchange, resolveSocialExit } from './social-encounter.ts'
import { applyDispositionDelta, dispositionMap } from './disposition.ts'
import { endEncounter, loadNpc, startSocial } from './social-staging.ts'
import type { NpcRow } from './social-staging.ts'
import { finishNegotiation } from './story.ts'
import type {
  ChallengeCheckStash, CheckStash, DoCheckStash, NegotiateStash, SayUtterance, SocialCheckStash,
} from './stashes.ts'
import { noteSuspicion } from './steward.ts'
import { assertOk, broadcast, commitDiffs, loadContext, loadState, logEvent } from './util.ts'

async function knowledgeFor(service: SupabaseClient, adventureId: string, npcId: string) {
  const { data, error } = await service
    .from('ingredients')
    .select('id, reveals, placement, reveals_to, discovered')
    .eq('adventure_id', adventureId)
    .eq('discovered', false)
    .eq('placement->>npc_id', npcId)
  assertOk(error, 'knowledge load failed')
  return (data ?? []).map((row) => {
    const placement = (row.placement ?? {}) as Record<string, Json>
    const revealsTo = (row.reveals_to ?? {}) as Record<string, Json>
    const candidate: RevealCandidate = {
      id: row.id as string,
      npcId: (placement.npc_id as string) ?? null,
      locationId: (placement.location_id as string) ?? null,
      condition: (placement.condition as string) ?? null,
      discovered: Boolean(row.discovered),
      boundCharacterId: (revealsTo.character_id as string) ?? null,
      anyPc: revealsTo.any_pc === true,
    }
    return { candidate, reveals: (row.reveals as string) ?? '' }
  })
}

interface NpcBundle {
  npc: NpcRow
  state: GameState
  sessionId: string | null
  buildContext: (constraint?: string, direction?: string) => NpcContext
  knowledge: { candidate: RevealCandidate; reveals: string }[]
  dispositions: Record<string, number>
}

/** Everything both the gist stage and the full reply need: npc row + agent context builder. */
async function loadNpcBundle(
  service: SupabaseClient,
  env: AgentEnv,
  npcId: string,
  utterance: SayUtterance,
  checkResult: (CheckResult & { skill: string }) | null,
): Promise<NpcBundle> {
  const npc = await loadNpc(service, env.adventureId, npcId)
  if (!npc) throw new Error('staged NPC row missing')
  const state = (await loadState(service, env.adventureId)).state

  const dispositions = await dispositionMap(service, npcId)
  const knowledge = await knowledgeFor(service, env.adventureId, npcId)
  const { data: memoryRows } = await service
    .from('npc_interactions')
    .select('summary')
    .eq('npc_id', npcId)
    .order('created_at', { ascending: false })
    .limit(3)
  // Retrieval memory (Slice 7): what past sessions established, relevant to this utterance.
  const retrieved = await retrieveMemories(service, env, `${npc.name}: ${utterance.text}`, 3)
  const { data: hookRows } = await service
    .from('hooks')
    .select('hook_text')
    .eq('adventure_id', env.adventureId)
    .eq('from_ref->>table', 'npcs')
    .eq('from_ref->>id', npcId)

  // Beat awareness (F08): the NPC steers conversation toward the open beat's live situations
  // instead of monologuing past them (the Elara volcano dead-end, seen live 2026-07-19).
  const loop = activeLoop(await loadLoops(service, env.adventureId))
  const { data: beatRow } = loop?.currentBeatId
    ? await service.from('beats').select('goals').eq('id', loop.currentBeatId).maybeSingle()
    : { data: null }
  const beatGoals = Array.isArray(beatRow?.goals)
    ? (beatRow.goals as unknown[]).filter((g): g is string => typeof g === 'string')
    : []

  const lineCounts = pcLineCounts(state)
  // Personalization (2026-07-20): the NPC reacts to who each PC is, not just their name.
  const profiles = await partyProfileLines(service, await loadPartyCharacters(service, env.adventureId))
  const personality = typeof npc.personality === 'object' && npc.personality !== null
    ? JSON.stringify(npc.personality)
    : String(npc.personality ?? '')

  const buildContext = (constraint?: string, direction?: string): NpcContext => ({
    npc: { id: npc.id, name: npc.name, personality, description: npc.description, faction: npc.faction },
    dispositionByPc: dispositions,
    memory: [...(memoryRows ?? []).map((m) => JSON.stringify(m.summary)), ...retrieved.map((m) => `Established earlier: ${m}`)],
    knowledge: knowledge.map((k) => ({ id: k.candidate.id, reveals: k.reveals, condition: k.candidate.condition })),
    conversation: {
      topicStack: state.dm?.conversation.topicStack ?? [],
      revealedThisScene: state.dm?.conversation.revealedThisScene ?? [],
    },
    recentLines: state.dialogue.lines.slice(-12).map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`),
    utterance,
    checkResult: checkResult
      ? { skill: checkResult.skill, success: checkResult.success, margin: checkResult.margin }
      : null,
    pcs: state.players.list.map((p) => ({
      characterId: p.characterId,
      name: p.name,
      linesThisScene: lineCounts.get(p.characterId) ?? 0,
    })),
    partyProfiles: profiles,
    hooks: (hookRows ?? []).map((h) => h.hook_text as string),
    beatGoals,
    constraint,
    direction,
  })

  return { npc, state, sessionId: state.session.id, buildContext, knowledge, dispositions }
}

/**
 * The NPC's turn (F10 SS3.3-3.7): agent call, reveal gate, consistency pass (one constrained
 * regen, then a guarded fallback + incident), then a single commit of dialogue + openings +
 * addressed PC. Also applies dispositions, marks reveals discovered, and executes conservative
 * auto actions. `direction` (Slice 2) steers the reply along the DM's chosen gist.
 */
export async function npcReply(
  service: SupabaseClient,
  env: AgentEnv,
  npcId: string,
  utterance: SayUtterance,
  checkResult: (CheckResult & { skill: string }) | null,
  direction?: string,
): Promise<void> {
  const { npc, state, sessionId, buildContext, knowledge, dispositions } = await loadNpcBundle(
    service, env, npcId, utterance, checkResult,
  )

  let output = await runNpcAgent(env, buildContext(undefined, direction))

  const npcs = [{ id: npc.id, name: npc.name }]
  const npcStates = state.dm?.facts.npcStates ?? {}
  // NPC replies used to be checked against an EMPTY fact sheet, so scene contradictions passed
  // ("if only I could reach the volcano" said while standing at it, seen live 2026-07-19).
  const npcFactSheet =
    `Location: the party and ${npc.name} are together at ${state.scene.locationName || 'an unknown place'} ` +
    `(scene mode: ${state.scene.mode}, day ${state.scene.day}), speaking face to face.`
  let verdict = await runConsistency(env, output.dialogue, npcs, npcStates, npcFactSheet)
  if (!verdict.ok) {
    const constraint = verdict.violations.map((v) => `${v.claim} (${v.conflictsWith})`).join('; ')
    await logEvent(service, env.adventureId, sessionId, 'consistency_blocked', { draft: output.dialogue, violations: constraint })
    if (!env.demo) {
      output = await runNpcAgent(env, buildContext(`NEVER: ${constraint}`, direction))
      verdict = await runConsistency(env, output.dialogue, npcs, npcStates, npcFactSheet)
    }
    if (env.demo || !verdict.ok) {
      await logEvent(service, env.adventureId, sessionId, 'incident', { kind: 'npc_consistency_failure', npc_id: npcId })
      output = { ...output, dialogue: `${npc.name} says nothing for a long moment.`, reveals: [], opening: null }
    }
  }

  // Server-side reveal gate - the model can ask for anything; only entitled ids pass.
  const gate = filterReveals(output.reveals, knowledge.map((k) => k.candidate), {
    npcId,
    actorCharacterId: utterance.actorCharacterId,
    checkPassed: checkResult?.success ?? false,
  })
  for (const blockedReveal of gate.blocked) {
    await logEvent(service, env.adventureId, sessionId, 'reveal_blocked', { ingredient_id: blockedReveal.id, reason: blockedReveal.reason })
  }
  for (const id of gate.allowed) {
    const { error } = await service.from('ingredients').update({ discovered: true }).eq('id', id)
    assertOk(error, 'ingredient discover failed')
    await logEvent(service, env.adventureId, sessionId, 'ingredient_revealed', {
      ingredient_id: id, npc_id: npcId, to: utterance.actorCharacterId,
    })
  }

  // Disposition only moves on something concrete (F10 guardrail): plain chat used to buy +1
  // a line, so any PC who kept talking reached devoted.
  await applyDispositionDelta(
    service, env.adventureId, sessionId, npcId, utterance.actorCharacterId,
    effectiveDispositionDelta(output.dispositionDelta.value, {
      checkResolved: checkResult !== null,
      revealed: gate.allowed.length > 0,
      proposedAction: output.proposedActions.length > 0,
    }),
    output.dispositionDelta.reason,
  )

  let newOpening: OpeningState | null = null
  if (output.opening && checkResult?.success) {
    newOpening = {
      id: crypto.randomUUID(),
      unlockedBy: output.opening.unlockedBy,
      npcId,
      skill: output.opening.skill,
      dcMod: openingDcMod(checkResult.margin),
      hint: `${npc.name} let something slip - ${output.opening.skill} eased`,
    }
    await logEvent(service, env.adventureId, sessionId, 'opening_emitted', {
      opening_id: newOpening.id, unlocked_by: newOpening.unlockedBy, skill: newOpening.skill, dc_mod: newOpening.dcMod,
    })
  }

  let npcLeaves = false
  for (const action of output.proposedActions) {
    if (action.type === 'canonize_theory') {
      // Player-theory canonization (F08 SS5): full-AI auto-approves only on a clean
      // Consistency pass; a contradiction is surfaced, never silently dropped. The DM
      // "Make it true" surface arrives with the Phase 10 console.
      const theory = action.theory.trim()
      if (!theory) continue
      // The retro-consistency check scans the whole registry, not just the staged NPC.
      const { data: registryNpcs } = await service.from('npcs').select('id, name').eq('adventure_id', env.adventureId)
      const theoryVerdict = await runConsistency(
        env, theory, ((registryNpcs ?? []) as { id: string; name: string }[]), npcStates, '',
      )
      const auto = env.mode === 'full_ai' && theoryVerdict.ok
      await recordProposal(service, {
        adventureId: env.adventureId,
        sessionId,
        type: 'canonization',
        payload: { npc_id: npcId, theory, violations: theoryVerdict.violations as unknown as Json },
        mode: auto ? 'auto' : 'human',
        summary: `Make it true: ${theory.slice(0, 60)}`,
      })
      if (!theoryVerdict.ok) {
        await logEvent(service, env.adventureId, sessionId, 'canonization_blocked', {
          npc_id: npcId, theory, violations: theoryVerdict.violations as unknown as Json,
        })
        continue
      }
      if (auto) {
        const { data: canonized, error: canonError } = await service
          .from('ingredients')
          .insert({
            adventure_id: env.adventureId,
            type: 'secret',
            content: { text: theory } as unknown as Json,
            reveals: theory,
            placement: { npc_id: npcId } as unknown as Json,
            canon_source: 'player_theory',
            discovered: true,
          })
          .select('id')
          .single()
        assertOk(canonError, 'canonized ingredient insert failed')
        await logEvent(service, env.adventureId, sessionId, 'theory_canonized', {
          npc_id: npcId, theory, ingredient_id: canonized.id,
        })
      }
      continue
    }
    const disposition = dispositions[utterance.actorCharacterId] ?? 0
    const allowed = env.demo || actionAutoAllowed(action, disposition)
    if (action.type === 'leave' && allowed) npcLeaves = true
    await logEvent(service, env.adventureId, sessionId, 'npc_action', {
      npc_id: npcId, action: action as unknown as Json, auto_applied: allowed,
    })
  }

  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'npc_reply',
    payload: { npc_id: npcId, dialogue: output.dialogue, reveals: gate.allowed } as unknown as Json,
    mode: 'auto',
    blocking: true,
    summary: `${npc.name}: ${output.dialogue.slice(0, 60)}`,
  })

  await commitDiffs(service, env.adventureId, (s) => {
    const diffs: StateDiff[] = [
      appendLinesDiff(s, [newLine(npc.name, npcId, output.dialogue)], {
        typing: false,
        addressedCharacterId: output.addressPc,
        ...(newOpening ? { openings: [...s.dialogue.openings, newOpening] as unknown as Json } : {}),
      }),
      ...pendingDiffs(null, null),
    ]
    if (gate.allowed.length > 0) {
      diffs.push({
        domain: 'dm',
        patch: {
          conversation: {
            revealedThisScene: [...(s.dm?.conversation.revealedThisScene ?? []), ...gate.allowed] as unknown as Json,
          },
        },
      })
    }
    return diffs
  })
  await logEvent(service, env.adventureId, sessionId, 'npc_reply', {
    npc_id: npcId, addressed: output.addressPc, revealed: gate.allowed, tone: output.tone,
  })

  // An accepted leave executes (F14: nothing else ends a social scene in full-AI): the NPC
  // steps down after their farewell line; the last one out closes the whole scene.
  if (npcLeaves) {
    const current = (await loadState(service, env.adventureId)).state
    const others = current.dialogue.speakers.filter((sp) => sp.npcId !== npcId)
    await logEvent(service, env.adventureId, sessionId, 'npc_left_scene', { npc_id: npcId })
    if (others.length === 0) {
      // endEncounter resolves an open social frame itself (nearest exit / left_unresolved).
      await endEncounter(service, env.adventureId, env.creatorId)
    } else {
      await commitDiffs(service, env.adventureId, (s) => [
        {
          domain: 'dialogue',
          patch: { speakers: s.dialogue.speakers.filter((sp) => sp.npcId !== npcId) as unknown as Json },
        },
      ])
    }
  }

  // Social encounter frame (Slice 4): count the exchange, then check the authored exits -
  // the disposition floor forces a hostile exit; the narrow judge decides the rest.
  const post = (await loadState(service, env.adventureId)).state
  if (post.encounter?.kind === 'social' && sessionId) {
    await recordSocialExchange(service, env, sessionId, utterance.actorCharacterId)
    const stagedIds = post.dialogue.speakers.map((sp) => sp.npcId)
    if (stagedIds.length > 0) {
      const detected = await detectSocialExit(service, env, sessionId, stagedIds)
      if (detected) {
        await endEncounter(service, env.adventureId, env.creatorId, { frameExit: 'skip' })
        await resolveSocialExit(service, env, sessionId, detected.exit, detected.forced)
      }
    }
  }
}

/**
 * The say pipeline entry (F10 SS3.1-3.2): append the player's line, classify, then either
 * reply directly (plain conversation) or post a check prompt with a table-derived DC,
 * auto-consuming a matching opening from a different PC.
 */
export async function handleSay(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  utterance: SayUtterance,
  targetNpcId: string | null,
) {
  const state = (await loadState(service, env.adventureId)).state
  const npcId = targetNpcId ?? state.dialogue.speakers[0]?.npcId
  if (!npcId) return { status: 409, body: { error: 'No NPC in this scene' } }
  const npc = await loadNpc(service, env.adventureId, npcId)
  if (!npc) return { status: 404, body: { error: 'NPC not found' } }

  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(utterance.actorName, null, utterance.text)], { typing: true }),
  ])
  await logEvent(service, env.adventureId, sessionId, 'say', {
    character_id: utterance.actorCharacterId, npc_id: npcId, text: utterance.text,
  })
  // Suspicion tagging (F08 SS8) - a failure here must never block the reply.
  try {
    await noteSuspicion(service, env, sessionId, utterance.text)
  } catch (err) {
    console.error('suspicion pass failed', err)
  }

  // typing:true is now committed and broadcast; any failure below must clear it or the input
  // row stays locked on "Waiting on the table..." for the whole table (the `do` path guards
  // the same way around its adjudicator call).
  try {
    const classification = await runSocialClassifier(env, utterance.text, `${npc.name}: ${npc.description}`)
    if (classification.kind === 'action') {
      // Unified input (2026-07-20): a physical action mid-conversation belongs to the action
      // pipelines, not the NPC. The line is committed and typing stays on - the intent
      // dispatcher re-routes and continues the flow.
      return { status: 200, body: { ok: true, resolved: 'action' } }
    }
    if (classification.kind === 'ask_dm') {
      // A question about the world, not to the NPC: the dispatcher answers it as narration.
      // Turning it into NPC speech let the room's contents come out of a character's mouth.
      return { status: 200, body: { ok: true, resolved: 'ask_dm' } }
    }
    if (classification.kind === 'conversation') {
      const resolved = await npcBeat(service, env, npcId, utterance, null)
      return { status: 200, body: { ok: true, resolved } }
    }

    const disposition = (await dispositionMap(service, npcId))[utterance.actorCharacterId] ?? 0
    let dc = socialDc(classification.kind === 'influence' ? classification.magnitude : 'reasonable', disposition)

    let openingId: string | null = null
    if (classification.kind === 'influence') {
      const opening = state.dialogue.openings.find((o) =>
        canConsumeOpening(o as OpeningView, {
          characterId: utterance.actorCharacterId, npcId, skill: classification.skill,
        }),
      )
      if (opening) {
        dc = Math.max(1, dc + opening.dcMod)
        openingId = opening.id
        await logEvent(service, env.adventureId, sessionId, 'opening_consumed', {
          opening_id: opening.id, by: utterance.actorCharacterId, unlocked_by: opening.unlockedBy, dc_mod: opening.dcMod,
        })
      }
    }

    const stash: SocialCheckStash = { flow: 'social', npcId, utterance, skill: classification.skill, dc, openingId }
    await commitDiffs(service, env.adventureId, (s) => [
      ...pendingDiffs(
        {
          kind: 'check',
          id: crypto.randomUUID(),
          actorCharacterId: utterance.actorCharacterId,
          skill: classification.skill,
          advDis: 'none',
          reason:
            classification.kind === 'insight'
              ? `Read ${npc.name}`
              : `${classification.skill} vs ${npc.name}${openingId ? ' (opening applied)' : ''}`,
          deadline: promptDeadline(new Date(), SOLO_PROMPT_WINDOW_S),
        },
        stash as unknown as Json,
      ),
      typingDiff(false),
      ...(openingId
        ? [{
            domain: 'dialogue' as const,
            patch: { openings: s.dialogue.openings.filter((o) => o.id !== openingId) as unknown as Json },
          }]
        : []),
    ])
    await broadcast(`game:${env.adventureId}`, 'check_prompted', { skill: classification.skill })
    return { status: 200, body: { ok: true, resolved: 'check_prompted', skill: classification.skill } }
  } catch (err) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    throw err
  }
}

/**
 * Resumes a checked flow with its final (possibly DM-overridden) outcome: social checks flow
 * into the NPC's next beat, do checks into outcome narration. Both downstream beats apply
 * their own dialogue gate.
 */
export async function continueAfterCheck(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  stash: CheckStash,
  result: CheckResult & { skill: string },
  detail: string,
): Promise<void> {
  if (stash.flow === 'negotiate') {
    await finishNegotiation(service, env, sessionId, stash, result)
    return
  }
  if (stash.flow === 'challenge') {
    // Skill-challenge attempt (encounter-states Slice 2): the engine counts the outcome.
    await commitDiffs(service, env.adventureId, () => [...pendingDiffs(null, null), typingDiff(true)])
    await challengeCheckResolved(service, env, sessionId, stash, result, detail)
    return
  }
  if (stash.flow === 'social') {
    await commitDiffs(service, env.adventureId, () => [typingDiff(true), ...pendingDiffs(null, null)])
    await npcBeat(service, env, stash.npcId, stash.utterance, result)
    return
  }
  await commitDiffs(service, env.adventureId, () => [...pendingDiffs(null, null), typingDiff(true)])
  // Scene Director: a successful check earns its stashed world movement (full-AI stashes only),
  // applied before narrating so the narrator grounds on the new scene.
  const stashEffects = result.success ? (stash.sceneEffects ?? null) : null
  let sceneNote = ''
  if (stashEffects) {
    const applied = await applySceneEffects(
      service, env, sessionId, stashEffects,
      {
        stageNpcs: (npcIds) => startSocial(service, env.adventureId, env.creatorId, npcIds),
        endScene: () => endEncounter(service, env.adventureId, env.creatorId),
      },
    )
    if (applied.sceneEnded) sceneNote += ' The conversation has ended; the party is on the move again.'
    if (applied.traveledTo) sceneNote += ` The party has just arrived at ${applied.traveledTo} - establish the new scene there.`
    if (applied.staged.length > 0) sceneNote += ` Present and in conversation now: ${applied.staged.join(', ')}.`
    if (applied.dayAdvanced !== null) sceneNote += ' Meaningful time passes during this - let the narration carry it.'
    if (applied.combatWon) sceneNote += ` A fight broke out ("${applied.combatWon}") and the party won decisively - narrate the clash and its immediate aftermath.`
  }
  // A successful `do` in a room holding authored evidence finds it (investigation pillar).
  if (result.success) {
    const scene = (await loadState(service, env.adventureId)).state.scene
    sceneNote += discoveryNote(
      await discoverAtLocation(service, env, sessionId, {
        locationId: scene.locationId,
        actorCharacterId: stash.actorCharacterId,
        checkPassed: true,
      }),
    )
  }
  await narrationBeat(
    service, env, sessionId,
    `Narrate this action outcome. ${stash.actorName} attempts: ${stash.interpretation}. ` +
      `The ${result.skill} check ${result.success ? 'SUCCEEDS' : 'FAILS'} (${detail}). ${stash.consequencesHint}${sceneNote}`,
    'Action outcome',
    'outcome',
  )
  if (stashEffects) await evaluateStoryProgress(service, env, sessionId)
}

/**
 * Slice 2 dispatcher: the NPC's next beat either auto-replies (full-AI, or assist with
 * auto-dialogue on) or stages a gist review for the DM console. Returns the resolved label.
 */
export async function npcBeat(
  service: SupabaseClient,
  env: AgentEnv,
  npcId: string,
  utterance: SayUtterance,
  checkResult: (CheckResult & { skill: string }) | null,
): Promise<'conversation' | 'review_staged'> {
  const state = (await loadState(service, env.adventureId)).state
  if (dialogueGateActive({ mode: env.mode, autoDialogue: dmSettings(state).autoDialogue })) {
    await stageReview(service, env, npcId, utterance, checkResult)
    return 'review_staged'
  }
  await npcReply(service, env, npcId, utterance, checkResult)
  return 'conversation'
}

/**
 * Stage 1 of the review gate: generate candidate gists and park them in dm.pendingReview.
 * Players see nothing (dm domain never reaches them); intents 409 until the DM decides.
 */
async function stageReview(
  service: SupabaseClient,
  env: AgentEnv,
  npcId: string,
  utterance: SayUtterance,
  checkResult: (CheckResult & { skill: string }) | null,
  rejected?: string[],
): Promise<void> {
  const bundle = await loadNpcBundle(service, env, npcId, utterance, checkResult)
  const gists = await runReplyGists(env, bundle.buildContext(), rejected)
  const review: PendingReviewState = {
    id: crypto.randomUUID(),
    kind: 'npc_reply',
    npcId,
    npcName: bundle.npc.name,
    utterance,
    checkResult: checkResult
      ? { skill: checkResult.skill, success: checkResult.success, margin: checkResult.margin }
      : null,
    candidates: gists.map((gist) => ({ id: crypto.randomUUID(), gist })),
    createdAt: new Date().toISOString(),
  }
  await commitDiffs(service, env.adventureId, () => [
    { domain: 'dm', patch: { pendingReview: review as unknown as Json } },
    typingDiff(false),
  ])
  await logEvent(service, env.adventureId, bundle.sessionId, 'review_staged', {
    review_id: review.id, npc_id: npcId, gists: gists as unknown as Json, regenerated: Boolean(rejected),
  })
}

/**
 * The DM console decision (Slice 2): pick a candidate gist / steer with their own gist /
 * regenerate the set / let the AI answer unsteered / dismiss with no reply. Send paths clear
 * the review first and restore it if expansion fails, so the DM can always retry.
 */
export async function reviewDecide(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  body: Record<string, unknown>,
) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can decide replies' } }
  const row = await loadState(service, adventureId)
  const review = row.state.dm?.pendingReview ?? null
  if (!review) return { status: 404, body: { error: 'No reply is awaiting review' } }
  if (body.review_id && String(body.review_id) !== review.id) {
    return { status: 409, body: { error: 'Stale review - a newer one replaced it' } }
  }

  const env: AgentEnv = {
    service, adventureId, creatorId: ctx.adventure.creator_id, demo: ctx.adventure.demo, mode: ctx.adventure.mode,
  }
  const sessionId = row.state.session.id
  const choice = String(body.choice ?? '')

  if (choice === 'dismiss') {
    await commitDiffs(service, adventureId, () => [
      { domain: 'dm', patch: { pendingReview: null } },
      typingDiff(false),
    ])
    await logEvent(service, adventureId, sessionId, 'review_decided', { review_id: review.id, choice })
    return { status: 200, body: { ok: true, resolved: 'dismissed' } }
  }

  // Check rulings (Slice 4): accept the rolled outcome or flip it, then resume the flow.
  if (review.kind === 'check_ruling') {
    if (choice !== 'accept' && choice !== 'flip') {
      return { status: 400, body: { error: 'A check ruling takes accept or flip' } }
    }
    const stash = (row.state.dm?.conversation.pendingContext ?? null) as
      | DoCheckStash | SocialCheckStash | NegotiateStash | ChallengeCheckStash | null
    if (!stash) return { status: 409, body: { error: 'Ruling context missing - the flow moved on' } }
    const flipped = choice === 'flip'
    const success = flipped ? !review.success : review.success
    const magnitude = Math.abs(review.margin) || 1
    const result = {
      rolls: [], d20: 0, modifier: 0,
      total: review.total, dc: review.dc,
      success, margin: success ? magnitude : -magnitude,
      skill: review.skill,
    }
    const detail = flipped ? `${review.detail}, DM override` : review.detail
    await commitDiffs(service, adventureId, () => [{ domain: 'dm', patch: { pendingReview: null } }])
    try {
      await continueAfterCheck(service, env, sessionId ?? '', stash, result, detail)
    } catch (err) {
      await commitDiffs(service, adventureId, () => [
        { domain: 'dm', patch: { pendingReview: review as unknown as Json } },
        typingDiff(false),
      ])
      throw err
    }
    await logEvent(service, adventureId, sessionId, 'review_decided', {
      review_id: review.id, choice, skill: review.skill, final_success: success,
    })
    return { status: 200, body: { ok: true, resolved: flipped ? 'flipped' : 'accepted', success } }
  }

  const checkResult = review.kind === 'npc_reply' && review.checkResult
    ? { ...review.checkResult, rolls: [], d20: 0, modifier: 0, total: 0, dc: 0 }
    : null

  if (choice === 'regenerate') {
    // Staging replaces pendingReview in place; the table stays locked throughout.
    const rejected = review.candidates.map((c) => c.gist)
    if (review.kind === 'narration') {
      await stageNarrationReview(service, env, sessionId ?? '', review.prompt, review.label, { rejected })
    } else {
      await stageReview(service, env, review.npcId, review.utterance, checkResult, rejected)
    }
    await logEvent(service, adventureId, sessionId, 'review_decided', { review_id: review.id, choice })
    return { status: 200, body: { ok: true, resolved: 'regenerated' } }
  }

  let direction: string | undefined
  if (choice === 'pick') {
    const candidate = review.candidates.find((c) => c.id === String(body.candidate_id ?? ''))
    if (!candidate) return { status: 404, body: { error: 'Candidate not found' } }
    direction = candidate.gist
  } else if (choice === 'steer') {
    direction = String(body.gist ?? '').trim().slice(0, 300)
    if (!direction) return { status: 400, body: { error: 'gist required to steer' } }
  } else if (choice !== 'auto') {
    return { status: 400, body: { error: `Unknown choice: ${choice}` } }
  }

  await commitDiffs(service, adventureId, () => [
    { domain: 'dm', patch: { pendingReview: null } },
    typingDiff(true),
  ])
  try {
    if (review.kind === 'narration') {
      // 'auto' mirrors the full-AI behavior: the first option is the AI's own pick.
      const chosen = direction ?? review.candidates[0].gist
      await publishNarration(service, env, sessionId ?? '', directedNarrationPrompt(review.prompt, chosen))
    } else {
      await npcReply(service, env, review.npcId, review.utterance, checkResult, direction)
    }
  } catch (err) {
    // Put the review back so the DM can retry instead of losing the beat.
    await commitDiffs(service, adventureId, () => [
      { domain: 'dm', patch: { pendingReview: review as unknown as Json } },
      typingDiff(false),
    ])
    throw err
  }
  await logEvent(service, adventureId, sessionId, 'review_decided', {
    review_id: review.id, choice, direction: direction ?? null,
  })
  return { status: 200, body: { ok: true, resolved: 'sent' } }
}
