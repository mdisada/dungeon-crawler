// Shared plumbing for the session function: auth context, the single-writer state store, and
// Realtime broadcasts. Phase 4 scaffolds F07's Adventure Manager contract - every state write
// goes through applyAndBroadcast (diff in, version bump, channel fan-out), nothing else
// touches adventure_state.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { applyDiffs, hashState, initialGameState } from '../_shared/state/index.ts'
import type { FxEvent, GameState, Json, StateDiff } from '../_shared/state/index.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

export function assertOk(error: { message: string } | null, context: string): void {
  if (error) throw new Error(`${context}: ${error.message}`)
}

export interface MemberRow {
  id: string
  adventure_id: string
  user_id: string
  role: 'dm' | 'player'
  character_id: string | null
  ready: boolean
  spectator: boolean
}

export interface AdventureRow {
  id: string
  creator_id: string
  dm_user_id: string | null
  mode: 'full_ai' | 'assist' | null
  status: string
  title: string
  min_players: number
  max_players: number
  invite_code: string
  demo: boolean
  party_profile: Json | null
  meta_loop: { premise?: string } | null
}

export const ADVENTURE_COLUMNS =
  'id, creator_id, dm_user_id, mode, status, title, min_players, max_players, invite_code, demo, party_profile, meta_loop'

/** Loads the adventure + the caller's membership; `isDm` covers role='dm' and the creator. */
export async function loadContext(service: SupabaseClient, adventureId: string, userId: string) {
  const { data: adventure, error } = await service
    .from('adventures')
    .select(ADVENTURE_COLUMNS)
    .eq('id', adventureId)
    .maybeSingle()
  assertOk(error, 'adventure load failed')
  if (!adventure) return null
  const { data: member, error: memberError } = await service
    .from('adventure_members')
    .select('*')
    .eq('adventure_id', adventureId)
    .eq('user_id', userId)
    .maybeSingle()
  assertOk(memberError, 'membership load failed')
  const adv = adventure as AdventureRow
  const isCreator = adv.creator_id === userId
  const isMember = isCreator || member !== null
  const isDm = isCreator || (member as MemberRow | null)?.role === 'dm'
  return { adventure: adv, member: member as MemberRow | null, isCreator, isMember, isDm }
}

/** Broadcasts on private channels through Realtime's HTTP endpoint (service role bypasses RLS). */
export async function broadcast(topic: string, event: string, payload: Json): Promise<void> {
  const res = await fetch(`${SUPABASE_URL}/realtime/v1/api/broadcast`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ messages: [{ topic, event, payload, private: true }] }),
  })
  if (!res.ok) console.error(`broadcast to ${topic} failed: ${res.status} ${await res.text()}`)
}

export interface StateRow {
  state: GameState
  state_version: number
}

export async function loadState(service: SupabaseClient, adventureId: string): Promise<StateRow> {
  const { data, error } = await service
    .from('adventure_state')
    .select('state, state_version')
    .eq('adventure_id', adventureId)
    .maybeSingle()
  assertOk(error, 'state load failed')
  if (data) return { state: data.state as GameState, state_version: Number(data.state_version) }
  return { state: initialGameState(), state_version: 0 }
}

/**
 * Media columns store storage paths (or absolute/public URLs for placeholders). State carries
 * ready-to-render URLs, so paths get signed here (1h - a resync refreshes them).
 */
export async function resolveMediaUrl(
  service: SupabaseClient,
  bucket: 'adventure-media' | 'characters',
  path: string | null,
): Promise<string | null> {
  if (!path) return null
  if (path.startsWith('http') || path.startsWith('/')) return path
  const { data } = await service.storage.from(bucket).createSignedUrl(path, 3600)
  return data?.signedUrl ?? null
}

/** Creates the state row at activation so applyAndBroadcast can always version-guard UPDATE. */
export async function ensureStateRow(service: SupabaseClient, adventureId: string): Promise<void> {
  const { error } = await service
    .from('adventure_state')
    .upsert(
      { adventure_id: adventureId, state: initialGameState() as unknown as Json, state_version: 0 },
      { onConflict: 'adventure_id', ignoreDuplicates: true },
    )
  assertOk(error, 'state bootstrap failed')
}

/** Strips DM-only domains for player clients (F06: hidden data never reaches players). */
export function playerVisibleState(state: GameState): GameState {
  return { ...state, dm: null }
}

/**
 * The single writer: applies diffs, bumps state_version (optimistic-locked on the previous
 * version), persists, and fans out. `dm`-domain diffs go to dm:{id} only; everything else to
 * game:{id}. Returns the new state + version.
 */
export async function applyAndBroadcast(
  service: SupabaseClient,
  adventureId: string,
  before: StateRow,
  diffs: StateDiff[],
  fx?: FxEvent[],
): Promise<StateRow> {
  const nextState = applyDiffs(before.state, diffs)
  const nextVersion = before.state_version + 1

  // Optimistic lock on the version we read: a concurrent writer makes this a 0-row update.
  const { data: updated, error } = await service
    .from('adventure_state')
    .update({
      state: nextState as unknown as Json,
      state_version: nextVersion,
      updated_at: new Date().toISOString(),
    })
    .eq('adventure_id', adventureId)
    .eq('state_version', before.state_version)
    .select('state_version')
  assertOk(error, 'state write failed')
  if (!updated || updated.length === 0) throw new Error('state write conflict (stale state_version)')

  const playerDiffs = diffs.filter((d) => d.domain !== 'dm')
  const dmDiffs = diffs.filter((d) => d.domain === 'dm')
  if (playerDiffs.length > 0 || fx) {
    await broadcast(`game:${adventureId}`, 'state_diff', {
      state_version: nextVersion,
      diffs: playerDiffs as unknown as Json,
      fx: (fx ?? []) as unknown as Json,
    })
  }
  if (dmDiffs.length > 0) {
    await broadcast(`dm:${adventureId}`, 'state_diff', {
      state_version: nextVersion,
      diffs: dmDiffs as unknown as Json,
    })
  }
  return { state: nextState, state_version: nextVersion }
}

export async function logEvent(
  service: SupabaseClient,
  adventureId: string,
  sessionId: string | null,
  type: string,
  payload: Json,
): Promise<void> {
  const { error } = await service
    .from('event_log')
    .insert({ adventure_id: adventureId, session_id: sessionId, type, payload })
  assertOk(error, 'event log write failed')
}

const AUTO_CHECKPOINT_KEEP = 20

/** Snapshot + prune (F05 SS4.2: last 20 automatic checkpoints, all manual ones). */
export async function writeCheckpoint(
  service: SupabaseClient,
  adventureId: string,
  sessionId: string | null,
  row: StateRow,
  kind: 'auto' | 'manual',
  label?: string,
): Promise<string> {
  const { data, error } = await service
    .from('checkpoints')
    .insert({
      adventure_id: adventureId,
      session_id: sessionId,
      kind,
      label: label ?? null,
      state_version: row.state_version,
      state_snapshot: row.state as unknown as Json,
    })
    .select('id')
    .single()
  assertOk(error, 'checkpoint write failed')

  const { data: autos } = await service
    .from('checkpoints')
    .select('id')
    .eq('adventure_id', adventureId)
    .eq('kind', 'auto')
    .order('created_at', { ascending: false })
  const stale = (autos ?? []).slice(AUTO_CHECKPOINT_KEEP).map((c) => c.id)
  if (stale.length > 0) await service.from('checkpoints').delete().in('id', stale)

  return data.id as string
}

export function snapshotHash(state: GameState): string {
  return hashState(state as unknown as Json)
}
