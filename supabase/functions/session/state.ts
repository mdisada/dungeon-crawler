// F06 SS6 state surface: role-filtered resync, server-validated move intents, and the Phase 4
// scripted demo driver that walks the renderers through every scene mode with dummy content.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { buildDemoScript, moveDiff, validateMove } from '../_shared/state/index.ts'
import type { DemoContext, Json } from '../_shared/state/index.ts'
import {
  applyAndBroadcast, assertOk, loadContext, loadState, logEvent, playerVisibleState, resolveMediaUrl, writeCheckpoint,
} from './util.ts'

/** Full-state resync for reconnect/late-join; players get the dm domain stripped. */
export async function resync(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { status: 404, body: { error: 'Adventure not found' } }
  const row = await loadState(service, adventureId)
  const state = ctx.isDm ? row.state : playerVisibleState(row.state)
  return {
    status: 200,
    body: {
      state: state as unknown as Json,
      state_version: row.state_version,
      role: ctx.isDm ? 'dm' : 'player',
      spectator: ctx.member?.spectator ?? false,
    },
  }
}

/** Token drag round-trip (F06 SS3.1): validate with the shared rules, commit, broadcast. */
export async function moveIntent(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  tokenId: string,
  to: { x: number; y: number },
) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { status: 404, body: { error: 'Adventure not found' } }
  if (ctx.member?.spectator) return { status: 403, body: { error: 'Spectators cannot move tokens' } }

  const row = await loadState(service, adventureId)
  const verdict = validateMove(row.state, tokenId, to, { userId, isDm: ctx.isDm })
  if (!verdict.ok) return { status: 200, body: { ok: false, reason: verdict.reason, state_version: row.state_version } }

  const diff = moveDiff(row.state.combat!, tokenId, to, verdict.cost)
  const after = await applyAndBroadcast(service, adventureId, row, [diff])
  await logEvent(service, adventureId, row.state.session.id, 'token_moved', {
    token_id: tokenId, to: to as unknown as Json, cost: verdict.cost, by: userId,
  })
  return { status: 200, body: { ok: true, state_version: after.state_version } }
}

/** DM Immersion tab (F06 SS5): background/map/music selection = Scene Manager intents. */
export async function setScene(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  patch: { location_id?: string; active_visual?: 'background' | 'map'; music_track?: string | null },
) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can change the scene' } }

  const scenePatch: Record<string, Json> = {}
  if (patch.active_visual === 'background' || patch.active_visual === 'map') {
    scenePatch.activeVisual = patch.active_visual
  }
  if (patch.music_track !== undefined) scenePatch.musicTrack = patch.music_track
  if (patch.location_id) {
    const { data: location, error } = await service
      .from('locations')
      .select('id, name, background_url, map')
      .eq('id', patch.location_id)
      .eq('adventure_id', adventureId)
      .maybeSingle()
    assertOk(error, 'location load failed')
    if (!location) return { status: 404, body: { error: 'Location not found' } }
    scenePatch.locationId = location.id
    scenePatch.locationName = location.name
    scenePatch.backgroundUrl = await resolveMediaUrl(service, 'adventure-media', location.background_url)
  }
  if (Object.keys(scenePatch).length === 0) return { status: 400, body: { error: 'Nothing to change' } }

  const row = await loadState(service, adventureId)
  const after = await applyAndBroadcast(service, adventureId, row, [{ domain: 'scene', patch: scenePatch }])
  return { status: 200, body: { ok: true, state_version: after.state_version } }
}

async function buildDemoContext(service: SupabaseClient, adventureId: string): Promise<DemoContext> {
  const [{ data: locations }, { data: npcs }, { data: objectives }, { data: members }] = await Promise.all([
    service.from('locations').select('id, name, background_url, map').eq('adventure_id', adventureId).order('created_at'),
    service.from('npcs').select('id, name, images').eq('adventure_id', adventureId).order('created_at'),
    service.from('objectives').select('id, title, chapter_id, index').eq('adventure_id', adventureId).order('index'),
    service.from('adventure_members').select('user_id, character_id, spectator').eq('adventure_id', adventureId),
  ])

  const location = (locations ?? []).find((l) => l.map) ?? (locations ?? [])[0]
  const map = (location?.map ?? null) as { imagePath?: string | null; obstacles?: [number, number][] } | null

  const characterIds = (members ?? []).filter((m) => !m.spectator && m.character_id).map((m) => m.character_id as string)
  const { data: chars } = characterIds.length
    ? await service.from('characters').select('id, user_id, name, images').in('id', characterIds)
    : { data: [] }

  // Characters store {tokenUrl, avatarUrl, ...} (F02); guide NPCs store {token, avatar, ...}.
  const imageOf = (images: Json): string | null => {
    if (typeof images !== 'object' || images === null || Array.isArray(images)) return null
    const set = images as Record<string, Json>
    const candidate =
      set.token ?? set.tokenUrl ?? set.avatar ?? set.avatarUrl ?? set.portrait ?? set.portraitUrl ?? null
    return typeof candidate === 'string' ? candidate : null
  }

  return {
    locationId: location?.id ?? 'demo-location',
    locationName: location?.name ?? 'Hollowbrook',
    backgroundUrl: await resolveMediaUrl(service, 'adventure-media', (location?.background_url as string | null) ?? null),
    mapUrl: await resolveMediaUrl(service, 'adventure-media', map?.imagePath ?? null),
    obstacles: map?.obstacles ?? [],
    npcs: await Promise.all(
      (npcs ?? []).slice(0, 2).map(async (n) => ({
        id: n.id,
        name: n.name,
        imageUrl: await resolveMediaUrl(service, 'adventure-media', imageOf(n.images as Json)),
      })),
    ),
    objectives: (objectives ?? []).slice(0, 2).map((o) => ({ id: o.id, title: o.title })),
    party: await Promise.all(
      (chars ?? []).map(async (c) => ({
        userId: c.user_id as string,
        characterId: c.id as string,
        name: c.name as string,
        imageUrl: await resolveMediaUrl(service, 'characters', imageOf(c.images as Json)),
      })),
    ),
  }
}

/**
 * Applies the next scripted demo step (DEVELOPMENT-PLAN PHASE 4). Step cursor = count of
 * demo_step events this session, so restarting the demo just means starting a new session.
 */
export async function demoStep(service: SupabaseClient, adventureId: string, userId: string) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can drive the demo' } }
  if (!ctx.adventure.demo) return { status: 409, body: { error: 'Not a demo adventure (seed one with SEED_DEMO)' } }

  const row = await loadState(service, adventureId)
  const sessionId = row.state.session.id
  if (!sessionId || row.state.session.status !== 'active') {
    return { status: 409, body: { error: 'Start a session first' } }
  }

  const { count, error: countError } = await service
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('session_id', sessionId)
    .eq('type', 'demo_step')
  assertOk(countError, 'demo cursor load failed')
  const cursor = count ?? 0

  const script = buildDemoScript(await buildDemoContext(service, adventureId))
  if (cursor >= script.length) {
    return { status: 200, body: { ok: true, done: true, step: cursor, total: script.length } }
  }

  const step = script[cursor]
  const modeBefore = row.state.scene.mode
  const after = await applyAndBroadcast(service, adventureId, row, step.diffs, step.fx)

  await logEvent(service, adventureId, sessionId, 'demo_step', { step: cursor, label: step.label })
  // Auto-checkpoint on scene-mode transitions (F05 SS4.2).
  if (after.state.scene.mode !== modeBefore) {
    await writeCheckpoint(service, adventureId, sessionId, after, 'auto', `mode: ${after.state.scene.mode}`)
  }

  return {
    status: 200,
    body: { ok: true, done: cursor + 1 >= script.length, step: cursor + 1, total: script.length, label: step.label },
  }
}
