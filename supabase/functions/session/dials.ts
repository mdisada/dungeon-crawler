// Story dials (F08 SS8.1): applying per-adventure dial values.
//
// Dial movement during play is judged by the scene ledger, in the same read it uses for
// milestones and the digest - an incremental event-sweep pass here was a second summarizer
// call over the same transcript at the same moment. What remains is the session-end summary
// (no phase closes there, so nothing else would judge it) and the shared apply half.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import { applyDialNudge } from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { runDialSummarizer } from './story-agents.ts'
import type { DialMove } from './story-agents.ts'
import { logEvent } from './util.ts'

interface DialSet {
  dials: { key: string; name: string; description: string }[]
  values: Record<string, number>
}

/** The adventure's declared dials + live values. Empty `dials` means there is nothing to move. */
async function loadDials(service: SupabaseClient, adventureId: string): Promise<DialSet> {
  const { data } = await service
    .from('adventures')
    .select('story_dials, dial_values')
    .eq('id', adventureId)
    .single()
  return {
    dials: (data?.story_dials ?? []) as DialSet['dials'],
    values: (data?.dial_values ?? {}) as Record<string, number>,
  }
}

/**
 * Runs the summarizer over `transcript` and applies the clamped nudges. Returns the number of
 * dials moved. Best-effort by contract - dial movement must never break the caller's flow.
 */
export async function applyDialMoves(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string | null,
  transcript: string[],
  preloaded?: DialSet,
): Promise<number> {
  if (transcript.length === 0) return 0
  const { dials, values: current } = preloaded ?? (await loadDials(service, env.adventureId))
  if (dials.length === 0) return 0

  const moves = await runDialSummarizer(env, dials, transcript)
  return applyDialNudges(service, env, sessionId, moves, current)
}

/**
 * Applies already-judged moves. Split out because the scene ledger judges dial movement in the
 * SAME read it uses for milestones and the digest - running a second summarizer over the same
 * transcript at the same moment was duplicated work.
 */
export async function applyDialNudges(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string | null,
  moves: DialMove[],
  currentValues?: Record<string, number>,
): Promise<number> {
  if (moves.length === 0) return 0
  const current = currentValues ?? (await loadDials(service, env.adventureId)).values
  const values = { ...current }
  for (const move of moves) {
    const next = applyDialNudge(values[move.dial] ?? 0, move.delta)
    await logEvent(service, env.adventureId, sessionId, 'dial_nudged', {
      dial: move.dial, from: values[move.dial] ?? 0, to: next, why: move.why,
    })
    values[move.dial] = next
  }
  await service.from('adventures').update({ dial_values: values as unknown as Json }).eq('id', env.adventureId)
  return moves.length
}
