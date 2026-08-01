// Social scene staging (F10 SS2/SS4/SS6): who is on stage, who steps down, and the
// on-the-fly generic NPC. Split out of npc-dialogue.ts, which had grown to 985 lines and 15
// sibling imports - the say pipeline reads this module, never the other way round.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { npcLocationAt } from '../_shared/guide/npc-itinerary.ts'
import type { ItineraryStop } from '../_shared/guide/npc-itinerary.ts'
import { stagedElsewhere } from '../_shared/story/index.ts'
import { mediaRef } from '../_shared/state/index.ts'
import type { Json, SpeakerSlot } from '../_shared/state/index.ts'
import { runGenericNpc, runInteractionSummary } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { recordSceneLedger } from './ledger.ts'
import { npcIsGroup } from './npc-state.ts'
import { recordProposal } from './proposals.ts'
import { detectSocialExit, resolveSocialExit } from './social-encounter.ts'
import {
  assertOk, commitDiffs, loadContext, loadState, logEvent,
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

function speakerSlot(npc: NpcRow, side: 'left' | 'right'): SpeakerSlot {
  return {
    npcId: npc.id,
    name: npc.name,
    side,
    image: mediaRef('adventure-media', npcImage(npc.images)),
  }
}

/** DM/creator launcher (F10 SS2): stage 1-3 NPCs and enter roleplay mode. */
/**
 * Splits a requested cast into those standing where the party is and those authored elsewhere.
 *
 * The comparison is `npcLocationAt(itinerary, currentObjectiveIndex)` against the scene's location -
 * the same derivation the narrator's CAST line already uses to say "Pell is over at the Drowned
 * Quarter". Conservative by construction: `npcLocationAt` returns null before an NPC's first stop
 * and for an empty itinerary, and `stagedElsewhere` treats every null as "allow".
 */
async function filterToHere(
  service: SupabaseClient,
  adventureId: string,
  npcs: readonly NpcRow[],
): Promise<{
  here: NpcRow[]
  elsewhere: { id: string; name: string; authoredLocationId: string | null; partyLocationId: string | null }[]
}> {
  const state = (await loadState(service, adventureId)).state
  const partyLocationId = state.scene.locationId ?? null
  if (!partyLocationId) return { here: [...npcs], elsewhere: [] }

  const { data: objectiveRows } = await service
    .from('objectives').select('id, index').eq('adventure_id', adventureId)
  const objectiveIndex = ((objectiveRows ?? []) as { id: string; index: number }[])
    .find((o) => o.id === state.objectives?.currentId)?.index ?? -1

  const { data: itineraryRows } = await service
    .from('npcs').select('id, itinerary').eq('adventure_id', adventureId)
    .in('id', npcs.map((n) => n.id))
  const byId = new Map(((itineraryRows ?? []) as { id: string; itinerary: ItineraryStop[] | null }[])
    .map((r) => [r.id, r.itinerary ?? []]))

  const here: NpcRow[] = []
  const elsewhere: { id: string; name: string; authoredLocationId: string | null; partyLocationId: string | null }[] = []
  for (const npc of npcs) {
    const authoredLocationId = npcLocationAt(byId.get(npc.id) ?? [], objectiveIndex)
    if (stagedElsewhere(authoredLocationId, partyLocationId)) {
      elsewhere.push({ id: npc.id, name: npc.name, authoredLocationId, partyLocationId })
    } else here.push(npc)
  }
  return { here, elsewhere }
}

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
    // A group cannot hold one conversation - staging it hands a faction a heartbeat and a seat.
    // The guide build removes these, but a human-edited group survives (warned, not deleted), so
    // the staging guard is the backstop that keeps it out of the roleplay frame regardless.
    if (await npcIsGroup(service, adventureId, npc.name)) {
      return {
        status: 409,
        body: { error: `${npc.name} is a group, not a single person, and cannot be staged. Create a named representative (an envoy, a captain) to speak for it.` },
      }
    }
    const npcState = liveStates[id] ?? (await npcInitialState(service, adventureId, id))
    if (npcState === 'dead' || npcState === 'absent') {
      return { status: 409, body: { error: `${npc.name} is ${npcState} and cannot be staged` } }
    }
    npcs.push(npc)
  }
  // NOBODY IS STAGED SOMEWHERE THEY ARE NOT (2026-07-30). The guards above ask who someone is and
  // whether they are alive; none ever asked WHERE they are. See `stagedElsewhere` for the run where
  // Mira Hoss - authored at Hoss cottage, explicitly left there packing a trunk - was re-staged at
  // Lock 3 after the party travelled, then voiced tactical orders in a scene she was not in.
  //
  // FILTERED, NOT REFUSED. Returning 409 here would fail the whole staging call and take the scene
  // with it, which is how refusing killed the Maren beat and charged the party a setback for a scene
  // nobody saw. Dropping the one person who does not belong leaves the scene to open with whoever
  // does. Only a KNOWN mismatch of two known places drops anyone; every uncertainty stages.
  const staged = await filterToHere(service, adventureId, npcs)
  for (const dropped of staged.elsewhere) {
    await logEvent(service, adventureId, null, 'incident', {
      kind: 'staging_elsewhere_dropped', npc_id: dropped.id, name: dropped.name,
      authored_at: dropped.authoredLocationId, party_at: dropped.partyLocationId,
    }).catch(() => {})
  }
  if (staged.here.length === 0) {
    return { status: 409, body: { error: 'Nobody in that group is where the party is standing' } }
  }

  const speakers: SpeakerSlot[] = []
  for (let i = 0; i < staged.here.length; i++) {
    speakers.push(speakerSlot(staged.here[i], i % 2 === 0 ? 'right' : 'left'))
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
    // No retrieval fragment here: the scene ledger below writes one for this same scene, with
    // per-PC contributions attached. Two agents summarising one scene into the same memory kind
    // was pure duplication. npc_interactions stays - loadNpcBundle reads it for NPC recall,
    // which the scene digest does not replace.
  }

  await commitDiffs(service, adventureId, () => [
    { domain: 'scene', patch: { mode: 'narration' } },
    {
      // activeLineId must clear too, or the last NPC line renders as the live narration
      // subtitle after the scene ends (lines stay as scroll-up history).
      domain: 'dialogue',
      patch: {
        speakers: [], openings: [], pending: null, activeLineId: null, addressedCharacterId: null,
        // typingSince rides along on every clear - a null DELETES the key, and a raise that finds
        // it absent leaves tableIsWedged with nothing to measure (2026-07-27).
        typing: false, typingSince: null,
      },
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
  await recordSceneLedger(service, env, state.session.id ?? '', 'scene',
    `conversation at ${state.scene.locationName || 'an unknown place'}`)
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
  const slot = speakerSlot(npc as NpcRow, row.state.dialogue.speakers.length % 2 === 0 ? 'right' : 'left')
  await commitDiffs(service, adventureId, (s) => [
    { domain: 'scene', patch: { mode: 'roleplay' } },
    { domain: 'dialogue', patch: { speakers: [...s.dialogue.speakers, slot] as unknown as Json } },
  ])
  await logEvent(service, adventureId, row.state.session.id, 'generic_npc_created', { npc_id: npc.id, name: seed.name })
  return { status: 200, body: { ok: true, npc_id: npc.id, name: seed.name } }
}

