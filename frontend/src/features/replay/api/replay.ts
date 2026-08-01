// Replay sandbox calls. Deliberately its own thin session-function client rather than reaching
// into features/play's api - the sandbox renders the play screen but must not own any of it.

import { callEdgeFunction } from '@/lib/edge-function'
import { supabase } from '@/lib/supabase'
import type { GameState } from '@rules/state'

import type { ReplayableAdventure, ReplayBattle, ReplayStatus } from '../types'

async function callSession<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const res = await callEdgeFunction('session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `Replay action failed (${res.status})`)
  return json as T
}

/**
 * Adventures worth replaying: everything that reached play. `completed` is the normal case;
 * `active` is included because entering a replay flips the status, and a sandbox you left open
 * has to stay findable.
 */
export async function listReplayableAdventures(): Promise<ReplayableAdventure[]> {
  const { data, error } = await supabase
    .from('member_adventures')
    .select('id, title, status, mode, created_at')
    .in('status', ['completed', 'active'])
    .order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  return (data ?? []).map((row) => ({
    id: row.id as string,
    title: row.title as string,
    status: row.status as string,
    mode: row.mode as 'full_ai' | 'assist' | null,
    createdAt: row.created_at as string,
  }))
}

export async function getReplayableAdventure(adventureId: string): Promise<ReplayableAdventure | null> {
  const { data, error } = await supabase
    .from('member_adventures')
    .select('id, title, status, mode, created_at')
    .eq('id', adventureId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return null
  return {
    id: data.id as string,
    title: data.title as string,
    status: data.status as string,
    mode: data.mode as 'full_ai' | 'assist' | null,
    createdAt: data.created_at as string,
  }
}

export function enterReplay(adventureId: string): Promise<{ seats: number }> {
  return callSession({ action: 'replay_control', adventure_id: adventureId, replay_command: 'enter' })
}

export function exitReplay(adventureId: string): Promise<{ ok: boolean }> {
  return callSession({ action: 'replay_control', adventure_id: adventureId, replay_command: 'exit' })
}

interface BattleRow {
  objective_id: string
  objective_title: string
  encounter_id: string
  label: string
  has_map: boolean
}

export async function listReplayBattles(adventureId: string): Promise<ReplayBattle[]> {
  const { battles } = await callSession<{ battles: BattleRow[] }>({
    action: 'replay_control',
    adventure_id: adventureId,
    replay_command: 'battles',
  })
  return (battles ?? []).map((b) => ({
    objectiveId: b.objective_id,
    objectiveTitle: b.objective_title,
    encounterId: b.encounter_id,
    label: b.label,
    hasMap: b.has_map,
  }))
}

export function startReplayCombat(
  adventureId: string,
  objectiveId: string,
  label: string,
): Promise<{ encounter_id: string; combatants: number }> {
  return callSession({
    action: 'replay_control',
    adventure_id: adventureId,
    replay_command: 'start_combat',
    objective_id: objectiveId,
    label,
  })
}

/**
 * Wipe the playthrough and restore the guide. `baseline` says how trustworthy the restored guide
 * is: 'activate' was captured before anyone played, 'backfill' was reconstructed after the fact.
 */
export function restartAdventure(
  adventureId: string,
): Promise<{ baseline: 'activate' | 'backfill' | 'unknown'; rows_restored: number }> {
  return callSession({ action: 'replay_control', adventure_id: adventureId, replay_command: 'restart' })
}

export function startReplaySession(adventureId: string): Promise<{ session_id: string; index: number }> {
  return callSession({ action: 'start_session', adventure_id: adventureId })
}

export function endReplaySession(adventureId: string): Promise<{ xp_gained: number }> {
  return callSession({ action: 'end_session', adventure_id: adventureId })
}

/**
 * One-shot state read for the panel's own readout. Deliberately not a Realtime subscription:
 * the play screen underneath already holds the `game:{id}` channel, and a second channel on the
 * same topic in one client is a subscription conflict, not a second view.
 */
export async function fetchReplayStatus(adventureId: string): Promise<ReplayStatus> {
  const data = await callSession<{ state: GameState; state_version: number }>({
    action: 'resync',
    adventure_id: adventureId,
  })
  const state = data.state
  return {
    sessionStatus: state.session.status,
    sceneMode: state.scene.mode,
    encounterLabel: state.encounter?.label ?? null,
    combatActive: !!state.combat,
    round: state.combat?.round ?? null,
    version: data.state_version,
  }
}
