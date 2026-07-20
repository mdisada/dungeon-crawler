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

// --- Phase 5 (F07 + F10): live intents -------------------------------------------------------

export interface IntentPayload {
  kind: 'say' | 'do' | 'roll'
  text?: string
  skill?: string
  target_id?: string
}

export function sendPlayerIntent(
  adventureId: string,
  intent: IntentPayload,
): Promise<{ resolved: string; total?: number; d20?: number; modifier?: number }> {
  return callSession({ action: 'player_intent', adventure_id: adventureId, ...intent })
}

export function rollPendingPrompt(
  adventureId: string,
  promptId: string,
  skill?: string,
): Promise<{ total: number; success?: boolean; waiting?: boolean }> {
  return callSession({
    action: 'roll_pending', adventure_id: adventureId, prompt_id: promptId,
    ...(skill ? { skill } : {}),
  })
}

export function claimAssistSlot(
  adventureId: string,
  promptId: string,
): Promise<{ assist_success: boolean; resolved: string }> {
  return callSession({ action: 'claim_assist', adventure_id: adventureId, prompt_id: promptId })
}

export function resolveExpiredPrompt(adventureId: string, promptId: string): Promise<{ resolved: string }> {
  return callSession({ action: 'resolve_pending', adventure_id: adventureId, prompt_id: promptId })
}

/** Gated (assist + auto-dialogue off): resolved 'review_staged', no text - the console takes over. */
export function narrateNextStory(
  adventureId: string,
  prompt?: string,
): Promise<{ options: string[]; chosen?: number; text?: string; resolved?: string }> {
  return callSession({ action: 'narrate_next', adventure_id: adventureId, prompt })
}

export function startSocialScene(adventureId: string, npcIds: string[]): Promise<{ staged: string[] }> {
  return callSession({ action: 'start_social', adventure_id: adventureId, npc_ids: npcIds })
}

/** Player asks the DM for a nudge ("get your bearings") - always lands, climbs the ladder. */
export function requestHint(adventureId: string): Promise<{ resolved: string; rung: number }> {
  return callSession({ action: 'hint', adventure_id: adventureId, requested: true })
}

/** Auto stuck-sweep (client timer, like the idle nudge): the server validates + dedups; 409 is normal. */
export async function sweepHint(adventureId: string): Promise<boolean> {
  try {
    await callSession({ action: 'hint', adventure_id: adventureId })
    return true
  } catch {
    return false
  }
}

export function endSocialEncounter(adventureId: string): Promise<unknown> {
  return callSession({ action: 'end_encounter', adventure_id: adventureId })
}

export function createGenericNpc(adventureId: string, roleHint: string): Promise<{ npc_id: string; name: string }> {
  return callSession({ action: 'generic_npc', adventure_id: adventureId, role_hint: roleHint })
}

// --- Debug telemetry (email-allowlisted, see supabase/functions/session/debug.ts) --------------

export interface DebugUsageStep {
  id: string
  agent_role: string
  model: string
  kind: 'text' | 'tts' | 'image' | 'embedding'
  prompt_tokens: number | null
  completion_tokens: number | null
  cost_usd: number | string | null
  latency_ms: number | null
  created_at: string
  response_text: string | null
}

export interface DebugEventRow {
  id: number
  type: string
  created_at: string
  payload: Record<string, unknown>
}

export interface DebugStory {
  mode: string | null
  location: string | null
  day: number | null
  objective: string | null
  loop: { type: string; beat: string | null; exit_conditions: unknown } | null
  off_loop_streak: number
  flags: Record<string, unknown>
  world: Record<string, unknown>
  /** The open encounter frame (encounter-states Slice 1), raw from GameState. */
  encounter: Record<string, unknown> | null
}

export function fetchDebugUsage(
  adventureId: string,
): Promise<{ steps: DebugUsageStep[]; events: DebugEventRow[]; story: DebugStory | null }> {
  return callSession({ action: 'debug_usage', adventure_id: adventureId })
}

// --- Slice 2: DM review console ---------------------------------------------------------------

export type ReviewDecision =
  | { choice: 'pick'; candidate_id: string }
  | { choice: 'steer'; gist: string }
  | { choice: 'regenerate' }
  | { choice: 'auto' }
  | { choice: 'dismiss' }
  | { choice: 'accept' }
  | { choice: 'flip' }

export function decideReview(
  adventureId: string,
  reviewId: string,
  decision: ReviewDecision,
): Promise<{ resolved: string }> {
  return callSession({ action: 'review_decide', adventure_id: adventureId, review_id: reviewId, ...decision })
}

export function setAutoSettings(
  adventureId: string,
  patch: { autoDialogue?: boolean; autoChecks?: boolean; nudgeMinutes?: number; hintTurns?: number },
): Promise<{ settings: { autoDialogue: boolean; autoChecks: boolean } }> {
  return callSession({
    action: 'player_intent',
    adventure_id: adventureId,
    kind: 'dm_command',
    command: 'set_auto',
    ...(patch.autoDialogue !== undefined ? { auto_dialogue: patch.autoDialogue } : {}),
    ...(patch.autoChecks !== undefined ? { auto_checks: patch.autoChecks } : {}),
    ...(patch.nudgeMinutes !== undefined ? { nudge_minutes: patch.nudgeMinutes } : {}),
    ...(patch.hintTurns !== undefined ? { hint_turns: patch.hintTurns } : {}),
  })
}
