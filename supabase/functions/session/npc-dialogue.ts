// F10 social encounters: scene staging, the say pipeline (classification -> optional check ->
// NPC Agent), server-side reveal gating, per-PC dispositions, social openings, on-the-fly
// generic NPCs, and scene-end interaction memory. The NPC Agent proposes; the guardrails in
// _shared/play decide.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  actionAutoAllowed, canConsumeOpening, clampDisposition, dialogueGateActive, dmSettings,
  filterReveals, openingDcMod, promptDeadline, socialDc, SOLO_PROMPT_WINDOW_S,
} from '../_shared/play/index.ts'
import type { CheckResult, OpeningView, RevealCandidate } from '../_shared/play/index.ts'
import type {
  GameState, Json, OpeningState, PendingReviewState, SpeakerSlot, StateDiff,
} from '../_shared/state/index.ts'
import {
  runConsistency, runGenericNpc, runInteractionSummary, runNpcAgent, runReplyGists, runSocialClassifier,
} from './agents.ts'
import type { AgentEnv, NpcContext } from './agents.ts'
import type { DoCheckStash } from './intent.ts'
import { directedNarrationPrompt, narrationBeat, publishNarration, stageNarrationReview } from './narration.ts'
import { appendLinesDiff, newLine, pcLineCounts, pendingDiffs, typingDiff } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import {
  assertOk, broadcast, commitDiffs, loadContext, loadState, logEvent, resolveMediaUrl,
} from './util.ts'

interface NpcRow {
  id: string
  name: string
  description: string
  faction: string
  personality: Json
  images: Json
}

async function loadNpc(service: SupabaseClient, adventureId: string, npcId: string): Promise<NpcRow | null> {
  const { data, error } = await service
    .from('npcs')
    .select('id, name, description, faction, personality, images')
    .eq('id', npcId)
    .eq('adventure_id', adventureId)
    .maybeSingle()
  assertOk(error, 'npc load failed')
  return data as NpcRow | null
}

function npcImage(images: Json): string | null {
  if (typeof images !== 'object' || images === null || Array.isArray(images)) return null
  const set = images as Record<string, Json>
  const candidate = set.portrait ?? set.avatar ?? set.token ?? null
  return typeof candidate === 'string' ? candidate : null
}

async function speakerSlot(service: SupabaseClient, npc: NpcRow, side: 'left' | 'right'): Promise<SpeakerSlot> {
  return {
    npcId: npc.id,
    name: npc.name,
    side,
    imageUrl: await resolveMediaUrl(service, 'adventure-media', npcImage(npc.images)),
  }
}

/** DM/creator launcher (F10 SS2): stage 1-3 NPCs and enter roleplay mode. */
export async function startSocial(service: SupabaseClient, adventureId: string, userId: string, npcIds: string[]) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM (or creator in Full-AI) can start a scene' } }
  if (npcIds.length === 0 || npcIds.length > 3) return { status: 400, body: { error: 'Pick 1-3 NPCs' } }

  const npcs: NpcRow[] = []
  for (const id of npcIds) {
    const npc = await loadNpc(service, adventureId, id)
    if (!npc) return { status: 404, body: { error: `NPC ${id} not found` } }
    npcs.push(npc)
  }
  const speakers: SpeakerSlot[] = []
  for (let i = 0; i < npcs.length; i++) {
    speakers.push(await speakerSlot(service, npcs[i], i % 2 === 0 ? 'right' : 'left'))
  }

  const after = await commitDiffs(service, adventureId, () => [
    { domain: 'scene', patch: { mode: 'roleplay' } },
    {
      domain: 'dialogue',
      patch: { speakers: speakers as unknown as Json, openings: [], addressedCharacterId: null },
    },
    { domain: 'dm', patch: { conversation: { topicStack: [], revealedThisScene: [], pendingContext: null } } },
  ])
  const sessionId = after.state.session.id
  await logEvent(service, adventureId, sessionId, 'social_started', { npc_ids: npcIds })
  return { status: 200, body: { ok: true, staged: speakers.map((s) => s.name) } }
}

/** Scene end (F10 SS6): distill interaction memory per staged NPC, clear scene-scoped state. */
export async function endEncounter(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM (or creator in Full-AI) can end the scene' } }
  const row = await loadState(service, adventureId)
  const { state } = row
  if (state.dialogue.speakers.length === 0) return { status: 409, body: { error: 'No social scene is active' } }

  const env: AgentEnv = { service, adventureId, creatorId: ctx.adventure.creator_id, demo: ctx.adventure.demo, mode: ctx.adventure.mode }
  const revealed = state.dm?.conversation.revealedThisScene ?? []
  for (const speaker of state.dialogue.speakers) {
    const transcript = state.dialogue.lines
      .filter((l) => l.npcId === speaker.npcId || (!l.npcId && l.speaker))
      .slice(-20)
      .map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`)
    const summary = await runInteractionSummary(env, speaker.name, transcript, revealed)
    const { error } = await service.from('npc_interactions').insert({
      adventure_id: adventureId,
      npc_id: speaker.npcId,
      session_id: state.session.id,
      summary: summary as unknown as Json,
    })
    assertOk(error, 'interaction memory write failed')
  }

  await commitDiffs(service, adventureId, () => [
    { domain: 'scene', patch: { mode: 'narration' } },
    {
      // activeLineId must clear too, or the last NPC line renders as the live narration
      // subtitle after the scene ends (lines stay as scroll-up history).
      domain: 'dialogue',
      patch: { speakers: [], openings: [], pending: null, activeLineId: null, addressedCharacterId: null, typing: false },
    },
    {
      domain: 'dm',
      patch: {
        conversation: { topicStack: [], revealedThisScene: [], pendingContext: null },
        // A pending gist review dies with its scene - otherwise the table lock outlives it.
        pendingReview: null,
      },
    },
  ])
  await logEvent(service, adventureId, state.session.id, 'social_ended', {
    npc_ids: state.dialogue.speakers.map((s) => s.npcId),
  })
  return { status: 200, body: { ok: true } }
}

/** On-the-fly generic NPC (F10 SS4): lightweight npcs row, staged immediately. */
export async function createGenericNpc(service: SupabaseClient, adventureId: string, userId: string, roleHint: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM (or creator in Full-AI) can create NPCs' } }
  const row = await loadState(service, adventureId)
  const env: AgentEnv = { service, adventureId, creatorId: ctx.adventure.creator_id, demo: ctx.adventure.demo, mode: ctx.adventure.mode }

  const seed = await runGenericNpc(env, roleHint, row.state.scene.locationName)
  const { data: npc, error } = await service
    .from('npcs')
    .insert({
      adventure_id: adventureId,
      name: seed.name,
      role: 'npc',
      generated: true,
      personality: { summary: seed.personality } as unknown as Json,
      description: `${roleHint || 'bystander'} - ${seed.personality}`,
      faction: '',
    })
    .select('id, name, description, faction, personality, images')
    .single()
  assertOk(error, 'generic npc insert failed')

  await recordProposal(service, {
    adventureId,
    sessionId: row.state.session.id,
    type: 'generic_npc',
    payload: { npc_id: npc.id, name: seed.name, personality: seed.personality },
    mode: ctx.adventure.mode === 'assist' ? 'human' : 'auto',
    summary: `Generic NPC: ${seed.name} (${roleHint || 'bystander'})`,
  })
  const slot = await speakerSlot(service, npc as NpcRow, row.state.dialogue.speakers.length % 2 === 0 ? 'right' : 'left')
  await commitDiffs(service, adventureId, (s) => [
    { domain: 'scene', patch: { mode: 'roleplay' } },
    { domain: 'dialogue', patch: { speakers: [...s.dialogue.speakers, slot] as unknown as Json } },
  ])
  await logEvent(service, adventureId, row.state.session.id, 'generic_npc_created', { npc_id: npc.id, name: seed.name })
  return { status: 200, body: { ok: true, npc_id: npc.id, name: seed.name } }
}

async function dispositionMap(service: SupabaseClient, npcId: string): Promise<Record<string, number>> {
  const { data, error } = await service.from('npc_dispositions').select('character_id, value').eq('npc_id', npcId)
  assertOk(error, 'disposition load failed')
  return Object.fromEntries((data ?? []).map((d) => [d.character_id as string, Number(d.value)]))
}

async function applyDispositionDelta(
  service: SupabaseClient,
  adventureId: string,
  sessionId: string | null,
  npcId: string,
  characterId: string,
  delta: number,
  reason: string,
): Promise<void> {
  if (delta === 0) return
  const current = (await dispositionMap(service, npcId))[characterId] ?? 0
  const next = clampDisposition(current + delta)
  const { error } = await service.from('npc_dispositions').upsert(
    { npc_id: npcId, character_id: characterId, adventure_id: adventureId, value: next, updated_at: new Date().toISOString() },
    { onConflict: 'npc_id,character_id' },
  )
  assertOk(error, 'disposition write failed')
  await logEvent(service, adventureId, sessionId, 'disposition_changed', {
    npc_id: npcId, character_id: characterId, from: current, to: next, reason,
  })
}

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

export interface SayUtterance {
  actorCharacterId: string
  actorName: string
  text: string
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
  const { data: hookRows } = await service
    .from('hooks')
    .select('hook_text')
    .eq('adventure_id', env.adventureId)
    .eq('from_ref->>table', 'npcs')
    .eq('from_ref->>id', npcId)

  const lineCounts = pcLineCounts(state)
  const personality = typeof npc.personality === 'object' && npc.personality !== null
    ? JSON.stringify(npc.personality)
    : String(npc.personality ?? '')

  const buildContext = (constraint?: string, direction?: string): NpcContext => ({
    npc: { id: npc.id, name: npc.name, personality, description: npc.description, faction: npc.faction },
    dispositionByPc: dispositions,
    memory: (memoryRows ?? []).map((m) => JSON.stringify(m.summary)),
    knowledge: knowledge.map((k) => ({ id: k.candidate.id, reveals: k.reveals, condition: k.candidate.condition })),
    conversation: {
      topicStack: state.dm?.conversation.topicStack ?? [],
      revealedThisScene: state.dm?.conversation.revealedThisScene ?? [],
    },
    utterance,
    checkResult: checkResult
      ? { skill: checkResult.skill, success: checkResult.success, margin: checkResult.margin }
      : null,
    pcs: state.players.list.map((p) => ({
      characterId: p.characterId,
      name: p.name,
      linesThisScene: lineCounts.get(p.characterId) ?? 0,
    })),
    hooks: (hookRows ?? []).map((h) => h.hook_text as string),
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
  let verdict = await runConsistency(env, output.dialogue, npcs, npcStates, '')
  if (!verdict.ok) {
    const constraint = verdict.violations.map((v) => `${v.claim} (${v.conflictsWith})`).join('; ')
    await logEvent(service, env.adventureId, sessionId, 'consistency_blocked', { draft: output.dialogue, violations: constraint })
    if (!env.demo) {
      output = await runNpcAgent(env, buildContext(`NEVER: ${constraint}`, direction))
      verdict = await runConsistency(env, output.dialogue, npcs, npcStates, '')
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

  await applyDispositionDelta(
    service, env.adventureId, sessionId, npcId,
    utterance.actorCharacterId, output.dispositionDelta.value, output.dispositionDelta.reason,
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

  for (const action of output.proposedActions) {
    const disposition = dispositions[utterance.actorCharacterId] ?? 0
    const allowed = env.demo || actionAutoAllowed(action, disposition)
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
}

export interface SocialCheckStash {
  flow: 'social'
  npcId: string
  utterance: SayUtterance
  skill: string
  dc: number
  openingId: string | null
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

  // typing:true is now committed and broadcast; any failure below must clear it or the input
  // row stays locked on "Waiting on the table..." for the whole table (the `do` path guards
  // the same way around its adjudicator call).
  try {
    const classification = await runSocialClassifier(env, utterance.text, `${npc.name}: ${npc.description}`)
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
  stash: DoCheckStash | SocialCheckStash,
  result: CheckResult & { skill: string },
  detail: string,
): Promise<void> {
  if (stash.flow === 'social') {
    await commitDiffs(service, env.adventureId, () => [typingDiff(true), ...pendingDiffs(null, null)])
    await npcBeat(service, env, stash.npcId, stash.utterance, result)
    return
  }
  await commitDiffs(service, env.adventureId, () => [...pendingDiffs(null, null), typingDiff(true)])
  await narrationBeat(
    service, env, sessionId,
    `Narrate this action outcome. ${stash.actorName} attempts: ${stash.interpretation}. ` +
      `The ${result.skill} check ${result.success ? 'SUCCEEDS' : 'FAILS'} (${detail}). ${stash.consequencesHint}`,
    'Action outcome',
  )
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
    const stash = (row.state.dm?.conversation.pendingContext ?? null) as DoCheckStash | SocialCheckStash | null
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
