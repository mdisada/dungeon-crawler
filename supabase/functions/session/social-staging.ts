// Social scene staging (F10 SS2/SS4/SS6): who is on stage, who steps down, and the
// on-the-fly generic NPC. Split out of npc-dialogue.ts, which had grown to 985 lines and 15
// sibling imports - the say pipeline reads this module, never the other way round.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json, SpeakerSlot } from '../_shared/state/index.ts'
import { runGenericNpc, runInteractionSummary } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { writeMemoryFragment } from './memory.ts'
import { recordProposal } from './proposals.ts'
import { detectSocialExit, resolveSocialExit } from './social-encounter.ts'
import {
  assertOk, commitDiffs, loadContext, loadState, logEvent, resolveMediaUrl,
} from './util.ts'

export interface NpcRow {
  id: string
  name: string
  description: string
  faction: string
  personality: Json
  images: Json
}

export async function loadNpc(service: SupabaseClient, adventureId: string, npcId: string): Promise<NpcRow | null> {
  const { data, error } = await service
    .from('npcs')
    .select('id, name, description, faction, personality, images')
    .eq('id', npcId)
    .eq('adventure_id', adventureId)
    .maybeSingle()
  assertOk(error, 'npc load failed')
  return data as NpcRow | null
}

/** Authored state at session start - a murder victim is 'dead' before anyone rolls a die. */
async function npcInitialState(service: SupabaseClient, adventureId: string, npcId: string): Promise<string> {
  const { data } = await service
    .from('npcs')
    .select('initial_state')
    .eq('id', npcId)
    .eq('adventure_id', adventureId)
    .maybeSingle()
  return (data?.initial_state as string | undefined) ?? 'alive'
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

  // The dead do not hold conversations. Blocking the STAGING is the real guard - leaving it to
  // the Consistency Checker only catches the corpse after it has already spoken (live
  // 2026-07-20). Both sources count: authored start state (the murder victim) and anyone who
  // has died since (dm.facts.npcStates).
  const liveStates = (await loadState(service, adventureId)).state.dm?.facts.npcStates ?? {}
  const npcs: NpcRow[] = []
  for (const id of npcIds) {
    const npc = await loadNpc(service, adventureId, id)
    if (!npc) return { status: 404, body: { error: `NPC ${id} not found` } }
    const npcState = liveStates[id] ?? (await npcInitialState(service, adventureId, id))
    if (npcState === 'dead' || npcState === 'absent') {
      return { status: 409, body: { error: `${npc.name} is ${npcState} and cannot be staged` } }
    }
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

/**
 * Scene end (F10 SS6): distill interaction memory per staged NPC, clear scene-scoped state.
 * If a social encounter frame is open (Slice 4), the scene ending resolves it - the judged
 * nearest exit, or left_unresolved. Pass frameExit: 'skip' when the caller resolves the
 * frame itself (exit detected mid-conversation).
 */
export async function endEncounter(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  opts?: { frameExit?: 'skip' },
) {
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
    // Retrieval memory (Slice 7): the distilled scene becomes a retrievable fragment.
    await writeMemoryFragment(
      service, env, 'scene_summary',
      `Conversation with ${speaker.name} at ${state.scene.locationName || 'an unknown place'}: ` +
        `${summary.said.join('; ') || 'small talk'}.` +
        (summary.promised.length > 0 ? ` Promised: ${summary.promised.join('; ')}.` : '') +
        ` Disposition: ${summary.disposition_trajectory}.`,
    )
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
  // A social frame outliving its scene resolves now: judged nearest exit or left_unresolved.
  if (opts?.frameExit !== 'skip' && state.encounter?.kind === 'social' && state.session.id) {
    const detected = await detectSocialExit(service, env, state.session.id, [])
    await resolveSocialExit(
      service, env, state.session.id,
      detected?.exit ?? null, detected?.forced ?? false,
    )
  }
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

