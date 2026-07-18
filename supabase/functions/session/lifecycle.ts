// F05 SS4: session start (recap + first-session pass), checkpoints, session end (summarize).
// Demo adventures use canned recap/summary text so scripted walkthroughs never call an LLM.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { bindCoopSet } from '../_shared/guide/affinity.ts'
import { AgentCallError, callAgentText } from '../_shared/llm.ts'
import type { DmState, Json, StateDiff } from '../_shared/state/index.ts'
import { recomputePartyProfile } from './membership.ts'
import {
  applyAndBroadcast, assertOk, broadcast, loadContext, loadState, logEvent, resolveMediaUrl, writeCheckpoint,
} from './util.ts'
import type { AdventureRow } from './util.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''

const asPatch = (value: unknown) => value as Json

async function openSession(service: SupabaseClient, adventureId: string) {
  const { data, error } = await service
    .from('sessions')
    .select('id, index, started_at')
    .eq('adventure_id', adventureId)
    .is('ended_at', null)
    .maybeSingle()
  assertOk(error, 'open session lookup failed')
  return data
}

/** Recap text (F05 SS4.1): previous summary -> "Previously on..."; first session -> premise. */
async function buildRecap(
  service: SupabaseClient,
  adventure: AdventureRow,
  sessionIndex: number,
): Promise<string> {
  const { data: lastSummary } = await service
    .from('session_summaries')
    .select('summary')
    .eq('adventure_id', adventure.id)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()

  const premise = adventure.meta_loop?.premise ?? ''
  if (adventure.demo) {
    return sessionIndex === 1
      ? premise || 'A quiet village, a missing boy, and a road that ends in torchlight. Your story begins.'
      : 'Previously: the party drove off the ambushers and earned the village\'s wary trust.'
  }

  try {
    const source = lastSummary
      ? `Write a "Previously on..." recap (max 120 words) from this session summary. Second person plural, present tense, no spoilers beyond what players witnessed:\n${JSON.stringify(lastSummary.summary)}`
      : `Write a spoiler-safe opening premise narration (max 120 words) for the players from this pitch. Do not reveal twists or hidden information:\n${premise}`
    return await callAgentText({
      serviceClient: service,
      openRouterApiKey: OPENROUTER_API_KEY,
      userId: adventure.creator_id,
      adventureId: adventure.id,
      agentRole: 'narrator',
      system: 'You are the narrator of a tabletop RPG session. Output only the narration text.',
      user: source,
      maxTokens: 400,
    })
  } catch (err) {
    // Recap is flavor, not state - a routing/LLM failure must not block session start.
    console.error('recap generation failed', err)
    return premise || 'The adventure continues.'
  }
}

/** First-session deferred pass (F05 SS3): party profile + concrete coop affinity bindings. */
async function firstSessionPass(service: SupabaseClient, adventureId: string): Promise<void> {
  await recomputePartyProfile(service, adventureId)

  const [{ data: members }, { data: coopIngredients }] = await Promise.all([
    service.from('adventure_members').select('character_id, spectator').eq('adventure_id', adventureId),
    service.from('ingredients').select('id, coop_set_id, reveals_to').eq('adventure_id', adventureId).not('coop_set_id', 'is', null),
  ])

  const characterIds = (members ?? []).filter((m) => !m.spectator && m.character_id).map((m) => m.character_id as string)
  if (characterIds.length === 0 || !coopIngredients || coopIngredients.length === 0) return

  const { data: chars } = await service
    .from('characters')
    .select('id, class_key, skill_proficiencies, personality')
    .in('id', characterIds)
  const party = (chars ?? []).map((c) => ({
    id: c.id as string,
    className: (c.class_key as string | null) ?? '',
    skills: (c.skill_proficiencies as string[] | null) ?? [],
    backgroundTags: [] as string[],
  }))

  const bySet = new Map<string, { ingredientId: string; revealsTo: Json }[]>()
  for (const row of coopIngredients) {
    const list = bySet.get(row.coop_set_id as string) ?? []
    list.push({ ingredientId: row.id as string, revealsTo: row.reveals_to as Json })
    bySet.set(row.coop_set_id as string, list)
  }

  // Applied directly rather than as DM proposals - the proposal tray is F07 (Phase 5);
  // deviation flagged on the Phase 4 checkpoint.
  for (const members of bySet.values()) {
    const bindings = bindCoopSet(
      members.map((m) => ({ ingredientId: m.ingredientId, revealsTo: m.revealsTo as never })),
      party,
    )
    for (const b of bindings) {
      await service
        .from('ingredients')
        .update({ reveals_to: b.boundTo === 'any_pc' ? { any_pc: true } : { character_id: b.boundTo } })
        .eq('id', b.ingredientId)
    }
  }
}

/** Assembles the session-start GameState domains from the guide + party. */
async function buildStartDiffs(
  service: SupabaseClient,
  adventure: AdventureRow,
  sessionId: string,
  sessionIndex: number,
  recap: string,
): Promise<StateDiff[]> {
  const [{ data: chapters }, { data: objectives }, { data: members }] = await Promise.all([
    service.from('chapters').select('id, index, title').eq('adventure_id', adventure.id).order('index'),
    service.from('objectives').select('id, chapter_id, index, title, reveal_state').eq('adventure_id', adventure.id).order('index'),
    service.from('adventure_members').select('user_id, character_id, spectator').eq('adventure_id', adventure.id),
  ])

  const firstChapter = (chapters ?? [])[0]
  const chapterObjectives = (objectives ?? []).filter((o) => o.chapter_id === firstChapter?.id)

  // Reveal the first objective of chapter 1 if nothing is revealed yet (server-side write so
  // the guide rows and the broadcast view agree).
  let revealed = (objectives ?? []).filter((o) => o.reveal_state !== 'hidden')
  if (revealed.length === 0 && chapterObjectives.length > 0) {
    const first = chapterObjectives[0]
    await service.from('objectives').update({ reveal_state: 'active' }).eq('id', first.id)
    first.reveal_state = 'active'
    revealed = [first]
  }

  const { data: location } = await service
    .from('locations')
    .select('id, name, background_url')
    .eq('adventure_id', adventure.id)
    .order('created_at')
    .limit(1)
    .maybeSingle()

  const characterIds = (members ?? []).filter((m) => !m.spectator && m.character_id).map((m) => m.character_id as string)
  const { data: chars } = characterIds.length
    ? await service.from('characters').select('id, user_id, name, hp_max, hp_current, hp_temp, persistent_conditions').in('id', characterIds)
    : { data: [] }

  const dmObjectives: DmState['objectives'] = (objectives ?? []).map((o) => ({
    id: o.id as string,
    title: o.title as string,
    hidden: o.reveal_state === 'hidden',
    state: o.reveal_state as string,
  }))

  return [
    {
      domain: 'session',
      patch: asPatch({ id: sessionId, index: sessionIndex, status: 'active', recap }),
    },
    {
      domain: 'scene',
      patch: asPatch({
        mode: 'narration',
        activeVisual: 'background',
        locationId: location?.id ?? null,
        locationName: location?.name ?? '',
        backgroundUrl: await resolveMediaUrl(service, 'adventure-media', location?.background_url ?? null),
        day: 1,
      }),
    },
    {
      domain: 'dialogue',
      patch: asPatch({
        lines: [{ id: `recap-${sessionId}`, speaker: null, npcId: null, text: recap }],
        activeLineId: `recap-${sessionId}`,
        speakers: [],
      }),
    },
    {
      domain: 'players',
      patch: asPatch({
        list: (chars ?? []).map((c) => ({
          userId: c.user_id,
          characterId: c.id,
          name: c.name,
          connected: false,
          hp: { current: c.hp_current ?? c.hp_max ?? 0, max: c.hp_max ?? 0, temp: c.hp_temp ?? 0 },
          conditions: ((c.persistent_conditions as Json[]) ?? []).map((x) => String(typeof x === 'object' && x !== null && 'name' in x ? (x as { name: string }).name : x)),
        })),
      }),
    },
    {
      domain: 'objectives',
      patch: asPatch({
        currentId: revealed[0]?.id ?? null,
        list: revealed.map((o) => ({
          id: o.id,
          title: o.title,
          state: o.reveal_state === 'hidden' ? 'revealed' : o.reveal_state,
        })),
      }),
    },
    { domain: 'dm', patch: asPatch({ objectives: dmObjectives, proposals: [] }) },
  ]
}

export async function startSession(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { status: 404, body: { error: 'Adventure not found' } }
  const { adventure } = ctx
  // Assist: the DM starts. Full-AI: the creator starts (F05 SS3).
  const mayStart = adventure.mode === 'assist' ? ctx.isDm : ctx.isCreator
  if (!mayStart) return { status: 403, body: { error: 'Only the DM (or creator in Full-AI) can start the session' } }
  if (adventure.status !== 'active') return { status: 409, body: { error: 'Adventure is not active' } }
  if (await openSession(service, adventureId)) return { status: 409, body: { error: 'A session is already running' } }

  // Server-side min-player gate (F05 acceptance criterion).
  const { data: members, error: membersError } = await service
    .from('adventure_members')
    .select('role, ready, character_id, spectator')
    .eq('adventure_id', adventureId)
  assertOk(membersError, 'members load failed')
  const readyPlayers = (members ?? []).filter((m) => m.role === 'player' && !m.spectator && m.ready && m.character_id)
  if (readyPlayers.length < adventure.min_players) {
    return {
      status: 409,
      body: { error: `Need ${adventure.min_players} ready player(s) with characters; have ${readyPlayers.length}` },
    }
  }

  const { data: lastSession } = await service
    .from('sessions')
    .select('index')
    .eq('adventure_id', adventureId)
    .order('index', { ascending: false })
    .limit(1)
    .maybeSingle()
  const sessionIndex = (lastSession?.index ?? 0) + 1

  const { data: session, error: sessionError } = await service
    .from('sessions')
    .insert({ adventure_id: adventureId, index: sessionIndex })
    .select('id')
    .single()
  assertOk(sessionError, 'session insert failed')
  const sessionId = session.id as string

  if (sessionIndex === 1) await firstSessionPass(service, adventureId)

  const recap = await buildRecap(service, adventure, sessionIndex)
  const before = await loadState(service, adventureId)
  const diffs = await buildStartDiffs(service, adventure, sessionId, sessionIndex, recap)
  const after = await applyAndBroadcast(service, adventureId, before, diffs)

  const checkpointId = await writeCheckpoint(service, adventureId, sessionId, after, 'auto', `session ${sessionIndex} start`)
  await service.from('sessions').update({ start_checkpoint_id: checkpointId }).eq('id', sessionId)
  await logEvent(service, adventureId, sessionId, 'session_started', { index: sessionIndex })

  return { status: 200, body: { ok: true, session_id: sessionId, index: sessionIndex, recap } }
}

export async function endSession(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { status: 404, body: { error: 'Adventure not found' } }
  const mayEnd = ctx.adventure.mode === 'assist' ? ctx.isDm : ctx.isCreator
  if (!mayEnd) return { status: 403, body: { error: 'Only the DM (or creator in Full-AI) can end the session' } }
  const session = await openSession(service, adventureId)
  if (!session) return { status: 409, body: { error: 'No session is running' } }

  const stateRow = await loadState(service, adventureId)
  await writeCheckpoint(service, adventureId, session.id, stateRow, 'auto', `session ${session.index} end`)

  const { data: events } = await service
    .from('event_log')
    .select('type, payload, created_at')
    .eq('session_id', session.id)
    .order('id')

  let summary: Json
  if (ctx.adventure.demo) {
    summary = {
      events: ['The party arrived, met the locals, and survived an ambush.'],
      npc_changes: [], promises: [], items: [],
      objective_progress: ['First objective completed.'],
    }
  } else {
    try {
      const text = await callAgentText({
        serviceClient: service,
        openRouterApiKey: OPENROUTER_API_KEY,
        userId: ctx.adventure.creator_id,
        adventureId,
        agentRole: 'summarizer',
        system:
          'Summarize a tabletop RPG session for future recaps. Reply with ONLY a JSON object: ' +
          '{"events": string[], "npc_changes": string[], "promises": string[], "items": string[], "objective_progress": string[]}. ' +
          'Include only things the players witnessed - never hidden GM information.',
        user: `Event log:\n${JSON.stringify(events ?? [])}`,
        maxTokens: 900,
      })
      const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '')
      summary = JSON.parse(cleaned) as Json
    } catch (err) {
      if (!(err instanceof AgentCallError) && !(err instanceof SyntaxError)) console.error('summarizer failed', err)
      summary = { events: (events ?? []).map((e) => e.type), npc_changes: [], promises: [], items: [], objective_progress: [] }
    }
  }

  const { data: summaryRow, error: summaryError } = await service
    .from('session_summaries')
    .insert({ adventure_id: adventureId, session_id: session.id, summary })
    .select('id')
    .single()
  assertOk(summaryError, 'summary write failed')

  const { error: closeError } = await service
    .from('sessions')
    .update({ ended_at: new Date().toISOString(), end_summary_id: summaryRow.id })
    .eq('id', session.id)
  assertOk(closeError, 'session close failed')

  await applyAndBroadcast(service, adventureId, stateRow, [
    { domain: 'session', patch: asPatch({ status: 'ended', recap: null }) },
  ])
  await logEvent(service, adventureId, session.id, 'session_ended', { index: session.index })

  // End-of-session card (F05 SS4.3). XP is 0 until F11; cost goes only to this caller (DM/creator).
  let cost: number | null = null
  if (ctx.isCreator) {
    const { data: usage } = await service
      .from('usage_log')
      .select('cost_usd')
      .eq('adventure_id', adventureId)
      .gte('created_at', session.started_at)
    cost = (usage ?? []).reduce((sum, u) => sum + Number(u.cost_usd ?? 0), 0)
  }
  await broadcast(`game:${adventureId}`, 'session_ended', {
    session_id: session.id, index: session.index, summary, xp_gained: 0,
  })
  return { status: 200, body: { ok: true, summary, xp_gained: 0, cost_usd: cost } }
}

export async function manualCheckpoint(service: SupabaseClient, adventureId: string, userId: string, label?: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can checkpoint' } }
  const session = await openSession(service, adventureId)
  const row = await loadState(service, adventureId)
  const id = await writeCheckpoint(service, adventureId, session?.id ?? null, row, 'manual', label)
  return { status: 200, body: { ok: true, checkpoint_id: id, state_version: row.state_version } }
}

/** DM-only, confirm-gated on the client; players resync from the broadcast signal (F05 SS4.2). */
export async function restoreCheckpoint(service: SupabaseClient, checkpointId: string, userId: string) {
  const { data: checkpoint, error } = await service
    .from('checkpoints')
    .select('id, adventure_id, state_snapshot')
    .eq('id', checkpointId)
    .maybeSingle()
  assertOk(error, 'checkpoint load failed')
  if (!checkpoint) return { status: 404, body: { error: 'Checkpoint not found' } }
  const ctx = await loadContext(service, checkpoint.adventure_id, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can restore' } }

  const current = await loadState(service, checkpoint.adventure_id)
  const nextVersion = current.state_version + 1
  const { error: writeError } = await service
    .from('adventure_state')
    .update({ state: checkpoint.state_snapshot, state_version: nextVersion, updated_at: new Date().toISOString() })
    .eq('adventure_id', checkpoint.adventure_id)
    .eq('state_version', current.state_version)
  assertOk(writeError, 'restore write failed')

  await logEvent(service, checkpoint.adventure_id, null, 'checkpoint_restored', { checkpoint_id: checkpointId })
  await broadcast(`game:${checkpoint.adventure_id}`, 'resync_required', { state_version: nextVersion })
  return { status: 200, body: { ok: true, state_version: nextVersion } }
}
