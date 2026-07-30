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
  /** `{ preset, pacing? }` - resolved into dm.settings.pacing at session start (session/pacing.ts). */
  difficulty_setting: Json | null
}

export const ADVENTURE_COLUMNS =
  'id, creator_id, dm_user_id, mode, status, title, min_players, max_players, invite_code, demo, ' +
  'party_profile, meta_loop, difficulty_setting'

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

/**
 * State I/O accounting for one request (2026-07-29, TEMPORARY - see the note below).
 *
 * Measured on run e8a51f01: only 24% of a turn's wall clock is spent waiting on models (204s of
 * 840s). The other 62% of turn time - 10.6s of every 17.1s - is unaccounted for, and the leading
 * theory is this module: `state` is a single 35-48 KB JSONB blob, 70-76% of it the dialogue
 * transcript, and every write is a read-modify-write of the whole thing. `state_version` reached
 * 243 in 30 turns, so roughly 8 of those cycles per turn, moving ~640 KB to record changes that
 * are individually tiny (`typingDiff(false)` flips one boolean and costs 80 KB of traffic).
 *
 * That is a THEORY. context-window.ts already proved the same instinct right for prompts - "it is
 * the PAYLOAD, not the length of the agent chain" - but this codebase's own rule is to read before
 * believing an instrument, and the last two efficiency theories in this session were both wrong on
 * first inspection. So: measure, then decide whether to move the apply into Postgres.
 *
 * DELETE THIS once the question is answered. It is instrumentation, not a feature.
 */
interface StatePerf {
  reads: number
  readMs: number
  writes: number
  writeMs: number
  conflicts: number
  /** Serialized size of the state, sampled ONCE per request - measuring it is not free either. */
  bytes: number
}

let statePerf: StatePerf = { reads: 0, readMs: 0, writes: 0, writeMs: 0, conflicts: 0, bytes: 0 }

/** Read and reset the counters. Called once per request by index.ts. */
export function takeStatePerf(): StatePerf {
  const sample = statePerf
  statePerf = { reads: 0, readMs: 0, writes: 0, writeMs: 0, conflicts: 0, bytes: 0 }
  return sample
}

/**
 * PER-REQUEST CACHES. Reset at the top of every request; never allowed to outlive one (2026-07-30).
 *
 * Measured on run fd892c6f: 5.8 full-state reads per request at 168ms each, all returning the same
 * ~28 KB blob, because loadState is called independently by publishNarration, buildCanon's callers,
 * the scene director and progress evaluation. 168ms for one indexed row by primary key is a round
 * trip, not a query - so the win is fewer trips, not a faster query.
 *
 * THREE HAZARDS, and all of them are why this is scoped to a single request:
 *
 * 1. MODULE SCOPE SURVIVES THE REQUEST. A Deno isolate is reused, so a cache with no reset would
 *    hand turn N+1 the state from turn N - a canon bug of exactly the class this codebase has spent
 *    its time removing. `resetRequestCaches()` runs at the top of the handler, not the bottom.
 * 2. commitDiffs MUST NOT SEE A CACHE. It re-reads deliberately and retries on `stale
 *    state_version`; served a cached blob it would retry against the same stale version three times
 *    and then throw, turning a recoverable write conflict into a failed turn. It calls
 *    `loadStateFresh` and drops the cache on success.
 * 3. CALLERS SHARE THE OBJECT. Six callers holding one reference means one mutation corrupts the
 *    rest, silently. Every read returns its own clone - sub-millisecond against a 168ms round trip.
 */
let stateCache: { adventureId: string; row: Promise<StateRow> } | null = null
let resolvedNodesCache: { adventureId: string; rows: Promise<ResolvedNode[]> } | null = null

export function resetRequestCaches(): void {
  stateCache = null
  resolvedNodesCache = null
}

/** Drops the state cache. Called by every writer - a cached blob past a write is a stale blob. */
export function invalidateStateCache(): void {
  stateCache = null
}

/** One resolved story node, oldest first. See `resolvedNodes`. */
export interface ResolvedNode {
  key: string
  tier: string | undefined
}

/**
 * Every `encounter_resolved` event, once per request.
 *
 * canon.ts ran this identical query THREE times per narration - establishedSoFar, nodePull and
 * nextPullIfHere each scanning `event_log where type='encounter_resolved'` independently, two of
 * them added on 2026-07-30. Same rows, same request, three round trips.
 */
export async function resolvedNodes(
  service: SupabaseClient,
  adventureId: string,
): Promise<ResolvedNode[]> {
  if (resolvedNodesCache && resolvedNodesCache.adventureId === adventureId) {
    return await resolvedNodesCache.rows
  }
  const load = (async () => {
    const { data } = await service
      .from('event_log')
      .select('payload')
      .eq('adventure_id', adventureId)
      .eq('type', 'encounter_resolved')
      .order('id', { ascending: true })
    return ((data ?? []) as { payload: { node_key?: string; tier?: string } }[])
      .flatMap((e) => (e.payload?.node_key ? [{ key: e.payload.node_key, tier: e.payload.tier }] : []))
  })()
  resolvedNodesCache = { adventureId, rows: load }
  return await load
}

export async function loadState(service: SupabaseClient, adventureId: string): Promise<StateRow> {
  if (stateCache && stateCache.adventureId === adventureId) {
    const cached = await stateCache.row
    // A CLONE PER CALLER - see hazard 3 above.
    return { state: structuredClone(cached.state), state_version: cached.state_version }
  }
  // The promise is cached, not the value, so concurrent callers inside one Promise.all share the
  // single in-flight read instead of each starting their own.
  const load = loadStateFresh(service, adventureId)
  stateCache = { adventureId, row: load }
  const row = await load
  return { state: structuredClone(row.state), state_version: row.state_version }
}

/** The uncached read. `commitDiffs` uses this directly - see hazard 2. */
export async function loadStateFresh(service: SupabaseClient, adventureId: string): Promise<StateRow> {
  const startedAt = Date.now()
  const { data, error } = await service
    .from('adventure_state')
    .select('state, state_version')
    .eq('adventure_id', adventureId)
    .maybeSingle()
  statePerf.reads++
  statePerf.readMs += Date.now() - startedAt
  assertOk(error, 'state load failed')
  if (data) {
    // Sampled once: JSON.stringify on a 40 KB object is cheap but not free, and doing it on every
    // read would have this instrument distorting the very number it exists to measure.
    if (statePerf.bytes === 0) {
      try {
        statePerf.bytes = JSON.stringify(data.state).length
      } catch { /* size is diagnostic only */ }
    }
    return { state: data.state as GameState, state_version: Number(data.state_version) }
  }
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
  const startedAt = Date.now()
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
  statePerf.writes++
  statePerf.writeMs += Date.now() - startedAt
  assertOk(error, 'state write failed')
  if (!updated || updated.length === 0) {
    // Counted separately: a conflict means commitDiffs re-reads and re-writes the whole blob
    // again, so a high conflict rate would be its own answer to "where does the time go".
    statePerf.conflicts++
    throw new Error('state write conflict (stale state_version)')
  }

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

/**
 * Commit wrapper for the intent pipeline (F07 SS2): rebuilds diffs from the freshest state and
 * retries on optimistic-lock conflicts, so slow agent calls can't strand a write behind a
 * faster concurrent intent. The builder must be pure in the state it receives.
 */
export async function commitDiffs(
  service: SupabaseClient,
  adventureId: string,
  build: (state: GameState) => StateDiff[],
  fx?: FxEvent[],
  attempts = 3,
): Promise<StateRow> {
  let lastError: unknown
  for (let i = 0; i < attempts; i++) {
    // FRESH, ALWAYS. The retry below exists to re-read after a concurrent writer bumped the
    // version; a cached blob would make every attempt see the same stale version and fail.
    const row = await loadStateFresh(service, adventureId)
    try {
      const written = await applyAndBroadcast(service, adventureId, row, build(row.state), fx)
      invalidateStateCache()
      return written
    } catch (err) {
      invalidateStateCache()
      lastError = err
      if (!(err instanceof Error) || !err.message.includes('stale state_version')) throw err
    }
  }
  throw lastError
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
  // A RESOLUTION INVALIDATES THE RESOLVED LIST (2026-07-30). `resolvedNodes` caches per request and
  // a resolution happens MID-request: resolveOpenEncounter logs this and the outcome narration
  // follows in the same invocation. Without this line that narration would read a list taken before
  // the resolution - `establishedSoFar` would omit the outcome_summary of the scene just played, and
  // `nodePull` would hand back the pull for a node that had already resolved.
  //
  // This is the whole point of caching per request rather than per scene: the invalidation has to
  // live on the write, and `logEvent` is the single chokepoint every event write passes through.
  if (type === 'encounter_resolved') resolvedNodesCache = null
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

/**
 * A TRANSITION IS NOT A PLACE, SO NOTHING HAPPENS "DURING" ONE (owner, 2026-07-30).
 *
 * The random-encounter roll on travel used to fire inside `applySceneEffects`, immediately after
 * `setScene` - so it read the DESTINATION's danger and table, named the hazard after the
 * destination, and narrated it, all before the caller's own narration said the party had arrived.
 * Run d3f20788 published "A hydraulic gauge on the control panel spikes" one millisecond before
 * "Lock 3 opens around them".
 *
 * The owner's framing is what resolved it: travelling is a transition, and an encounter has to
 * happen somewhere - so it belongs to the scene BEFORE or the scene AFTER, never to the move. It is
 * an ARRIVAL encounter. Rolling against the destination was already right; narrating it before the
 * arrival was the whole bug.
 *
 * Parked rather than threaded through callers on purpose. entry.ts alone has five return paths
 * after `applySceneEffects`, and a fix that has to be repeated at each one is a fix that will be
 * missed at one. `publishNarration` is the single chokepoint every narration passes through, so
 * flushing there puts the spawn after whichever narration the turn actually produced.
 *
 * A miss is harmless: a turn that publishes nothing simply skips the roll, and a skipped random
 * encounter costs the story nothing (13 spawns in 182 rolls across every recorded run).
 */
const arrivalSpawns: (() => Promise<unknown>)[] = []

export function parkArrivalSpawn(run: () => Promise<unknown>): void {
  arrivalSpawns.push(run)
}

/**
 * Runs and clears any parked arrival spawn. Drained BEFORE awaiting, so the spawn's own narration -
 * which comes back through publishNarration - cannot re-enter and fire it a second time.
 */
export async function flushArrivalSpawns(): Promise<void> {
  const due = arrivalSpawns.splice(0, arrivalSpawns.length)
  for (const run of due) await run().catch((err) => console.error('arrival spawn failed', err))
}
