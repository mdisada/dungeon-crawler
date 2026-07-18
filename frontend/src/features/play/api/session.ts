// All Phase 4 writes go through the session edge function (server-enforced capacity, locking,
// gating - see supabase/functions/session). Reads stay direct supabase queries in lobby.ts.

import { callEdgeFunction } from '@/lib/edge-function'
import { timeJob } from '@/lib/job-timer'

async function callSession<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { result } = await timeJob(`session:${String(body.action)}`, async () => {
    const res = await callEdgeFunction('session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>
    if (!res.ok) throw new Error(typeof json.error === 'string' ? json.error : `session action failed (${res.status})`)
    return json as T
  })
  return result
}

export function activateAdventure(adventureId: string): Promise<{ title: string }> {
  return callSession({ action: 'activate', adventure_id: adventureId })
}

export function joinByInvite(inviteCode: string): Promise<{ adventure_id: string; spectator?: boolean }> {
  return callSession({ action: 'join', invite_code: inviteCode })
}

export function pickCharacter(adventureId: string, characterId: string | null): Promise<{ warning: string | null }> {
  return callSession({ action: 'pick_character', adventure_id: adventureId, character_id: characterId })
}

export function setReady(adventureId: string, ready: boolean): Promise<unknown> {
  return callSession({ action: 'ready', adventure_id: adventureId, ready })
}

export function admitMember(adventureId: string, memberId: string): Promise<unknown> {
  return callSession({ action: 'admit', adventure_id: adventureId, member_id: memberId })
}

export function leaveAdventure(adventureId: string): Promise<unknown> {
  return callSession({ action: 'leave', adventure_id: adventureId })
}

export function regenInvite(adventureId: string): Promise<{ invite_code: string }> {
  return callSession({ action: 'regen_invite', adventure_id: adventureId })
}

export function startSession(adventureId: string): Promise<{ session_id: string; index: number }> {
  return callSession({ action: 'start_session', adventure_id: adventureId })
}

export function endSession(
  adventureId: string,
): Promise<{ summary: Record<string, string[]>; xp_gained: number; cost_usd: number | null }> {
  return callSession({ action: 'end_session', adventure_id: adventureId })
}

export function createCheckpoint(adventureId: string, label?: string): Promise<{ checkpoint_id: string }> {
  return callSession({ action: 'checkpoint', adventure_id: adventureId, label })
}

export function restoreCheckpoint(checkpointId: string): Promise<unknown> {
  return callSession({ action: 'restore_checkpoint', checkpoint_id: checkpointId })
}

export function fetchResync(adventureId: string): Promise<{
  state: unknown
  state_version: number
  role: 'dm' | 'player'
  spectator: boolean
}> {
  return callSession({ action: 'resync', adventure_id: adventureId })
}

export function sendMoveIntent(
  adventureId: string,
  tokenId: string,
  to: { x: number; y: number },
): Promise<{ ok: boolean; reason?: string; state_version: number }> {
  return callSession({ action: 'move_intent', adventure_id: adventureId, token_id: tokenId, to })
}

export function setScene(
  adventureId: string,
  patch: { location_id?: string; active_visual?: 'background' | 'map'; music_track?: string | null },
): Promise<unknown> {
  return callSession({ action: 'set_scene', adventure_id: adventureId, ...patch })
}

export function demoStep(
  adventureId: string,
): Promise<{ done: boolean; step: number; total: number; label?: string }> {
  return callSession({ action: 'demo_step', adventure_id: adventureId })
}
