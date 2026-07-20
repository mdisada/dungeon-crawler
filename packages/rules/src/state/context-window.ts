// Agent context assembly. Closed phases collapse to a one-line digest; only the lines since
// the last phase closed are still sent raw.
//
// Why: the raw transcript grew all session and it is the PAYLOAD, not the length of the agent
// chain, that pushed workers past their resource ceiling (~19% of player turns failed live,
// 2026-07-21). Long-story research finds the same shape - contradictions accumulate roughly
// linearly with the text a model has to hold. Players are unaffected: dialogue.lines keeps the
// full scroll-back, this is only what we pay to send.

import type { GameState } from './types.ts'

/** Closed-phase digests kept in the window; older ones fall off. */
export const MAX_DIGESTS = 6

function render(speaker: string | null, text: string): string {
  return `${speaker ?? 'Narrator'}: ${text}`
}

/**
 * The agent-facing transcript: digests of closed phases, then up to `rawLimit` live lines.
 * `rawLimit` applies only to the live tail - digests are already one line each.
 */
export function agentContextLines(state: GameState, rawLimit: number): string[] {
  const digests = (state.dm?.contextWindow?.digests ?? []).slice(-MAX_DIGESTS)
  return [
    ...digests.map((d) => `Earlier: ${d}`),
    ...liveLines(state).slice(-rawLimit).map((l) => render(l.speaker, l.text)),
  ]
}

/**
 * The raw lines since the last phase closed - what the Archivist reads to write the next
 * digest. Falls back to the whole (already bounded) history when the boundary line has aged
 * out, so a long phase is never summarised from nothing.
 */
export function liveLines(state: GameState): GameState['dialogue']['lines'] {
  const lines = state.dialogue.lines
  const since = state.dm?.contextWindow?.sinceLineId ?? null
  if (!since) return lines
  const cut = lines.findIndex((l) => l.id === since)
  return cut >= 0 ? lines.slice(cut) : lines
}

/** The digest list after closing a phase; empty digests are skipped but the boundary moves. */
export function nextDigests(existing: string[], digest: string): string[] {
  return (digest.trim() ? [...existing, digest.trim()] : existing).slice(-MAX_DIGESTS)
}
