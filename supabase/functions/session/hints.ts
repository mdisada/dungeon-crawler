// Player-requested "get your bearings" (overhaul Phase 3).
//
// This file used to hold TWO of the three uncoordinated pacing ladders: the auto stuck-hint
// sweep (rungs 1-4 off its own no-progress counters) and the dead-table stall promoter (its
// own fold-streak counter, opening content with empty outcome maps by design). Both are gone -
// their counters, thresholds and content are now rungs of the single Progress Director
// (session/director.ts + escalation.ts), which runs on every turn and can actually move the
// spine. What remains is the on-demand surface: a player asking the DM for a steer.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { AgentEnv } from './agents.ts'
import { deliverRequestedHint } from './escalation.ts'
import { loadPlayContext } from './orchestrate.ts'
import { loadState, logEvent } from './util.ts'

/**
 * The player asked. Always lands (unlike the director's rungs, which hold until the streak
 * earns them) - the ask IS the signal. Guards mirror the director: narrative mode, table not
 * busy.
 */
export async function hintAction(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  requested: boolean,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const row = await loadState(service, adventureId)
  const guard = await loadPlayContext(service, adventureId, userId, row.state)
  if (!guard.ok) return { status: guard.status, body: { error: guard.error } }
  const play = guard.value
  const state = row.state

  if (!['narration', 'roleplay', 'downtime', 'puzzle'].includes(state.scene.mode)) {
    return { status: 409, body: { error: 'No hints in this scene mode' } }
  }
  if (state.dialogue.pending || state.dialogue.typing || state.dm?.pendingReview) {
    return { status: 409, body: { error: 'The table is busy' } }
  }
  // The automatic side of this endpoint is the director's job now; a client sweep asking for
  // an unrequested hint has nothing to add.
  if (!requested) {
    return { status: 409, body: { error: 'Automatic pacing is handled server-side' } }
  }

  const env: AgentEnv = {
    service, adventureId, creatorId: play.adventure.creator_id, demo: play.demo, mode: play.adventure.mode,
  }
  await deliverRequestedHint(service, env, play.sessionId, state)
  await logEvent(service, adventureId, play.sessionId, 'hint_given', { rung: 2, source: 'requested' })
  return { status: 200, body: { ok: true, resolved: 'hint', rung: 2 } }
}
