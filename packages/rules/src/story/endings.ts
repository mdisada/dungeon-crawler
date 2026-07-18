// Ending Steward deterministic core (F08 SS8.1): score candidate endings by summing weights
// of currently-true signals - pure lookups over objective outcomes, NPC states, and dial
// values. The argmax leads (ties break by lowest index, so one always leads); commitment fires
// only late and decisively. An Engine, not an LLM.

import type { Json } from '../state/types.ts'

export type EndingSignalWhen =
  | { objective_id: string; outcome: 'completed' | 'failed' }
  | { npc_id: string; state: 'dead' | 'alive' | 'allied' | 'hostile' }
  | { dial: string; gte?: number; lte?: number }

export interface EndingSignal {
  when: EndingSignalWhen
  weight: number
}

export interface EndingCandidate {
  id: string
  index: number
  signals: EndingSignal[]
}

export interface EndingWorld {
  objectiveOutcomes: Record<string, 'completed' | 'failed'>
  npcStates: Record<string, string>
  dialValues: Record<string, number>
}

export const DIAL_MIN = -5
export const DIAL_MAX = 5

/** Per-scene dial nudges clamp to +/-2 (defining moment), values to [-5, 5] (F08 SS8.1). */
export function applyDialNudge(current: number, delta: number): number {
  const clampedDelta = Math.max(-2, Math.min(2, Math.round(delta)))
  return Math.max(DIAL_MIN, Math.min(DIAL_MAX, (current || 0) + clampedDelta))
}

function signalHolds(when: EndingSignalWhen, world: EndingWorld): boolean {
  if ('objective_id' in when) return world.objectiveOutcomes[when.objective_id] === when.outcome
  if ('npc_id' in when) {
    const state = world.npcStates[when.npc_id]
    if (when.state === 'alive') return state !== undefined && state !== 'dead'
    return state === when.state
  }
  const value = world.dialValues[when.dial]
  if (value === undefined) return false
  if (when.gte !== undefined && !(value >= when.gte)) return false
  if (when.lte !== undefined && !(value <= when.lte)) return false
  return when.gte !== undefined || when.lte !== undefined
}

export interface EndingScores {
  scores: Record<string, number>
  /** Never null while candidates exist - ties break by lowest index (no dead-end). */
  leadingId: string | null
}

export function scoreEndings(candidates: EndingCandidate[], world: EndingWorld): EndingScores {
  const scores: Record<string, number> = {}
  for (const candidate of candidates) {
    scores[candidate.id] = candidate.signals.reduce(
      (sum, signal) => (signalHolds(signal.when, world) ? sum + signal.weight : sum),
      0,
    )
  }
  const leading = [...candidates].sort((a, b) => {
    const diff = (scores[b.id] ?? 0) - (scores[a.id] ?? 0)
    return diff !== 0 ? diff : a.index - b.index
  })[0]
  return { scores, leadingId: leading?.id ?? null }
}

/** Commitment gate (F08 SS8.1): decisive margin + enough recorded play, near the climax. */
export const COMMIT_MIN_MARGIN = 3
export const COMMIT_MIN_EVENTS = 30

export function commitmentReady(
  scoresByEnding: Record<string, number>,
  leadingId: string | null,
  eventCount: number,
): boolean {
  if (!leadingId || eventCount < COMMIT_MIN_EVENTS) return false
  const leading = scoresByEnding[leadingId] ?? 0
  if (leading <= 0) return false
  const runnerUp = Math.max(
    0,
    ...Object.entries(scoresByEnding)
      .filter(([id]) => id !== leadingId)
      .map(([, score]) => score),
  )
  return leading - runnerUp >= COMMIT_MIN_MARGIN
}

/** Parses stored trigger_conditions signals into the closed-vocabulary shape (drops junk). */
export function parseEndingSignals(raw: Json): EndingSignal[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
  const signals = (raw as Record<string, Json>).signals
  if (!Array.isArray(signals)) return []
  return signals.flatMap((s): EndingSignal[] => {
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return []
    const sig = s as Record<string, Json>
    const weight = Number(sig.weight)
    if (!Number.isFinite(weight) || weight === 0) return []
    const when = sig.when
    if (typeof when !== 'object' || when === null || Array.isArray(when)) return []
    const w = when as Record<string, Json>
    if (typeof w.objective_id === 'string' && (w.outcome === 'completed' || w.outcome === 'failed')) {
      return [{ when: { objective_id: w.objective_id, outcome: w.outcome }, weight }]
    }
    if (typeof w.npc_id === 'string' && ['dead', 'alive', 'allied', 'hostile'].includes(String(w.state))) {
      return [{ when: { npc_id: w.npc_id, state: w.state as 'dead' | 'alive' | 'allied' | 'hostile' }, weight }]
    }
    if (typeof w.dial === 'string' && (typeof w.gte === 'number' || typeof w.lte === 'number')) {
      return [{
        when: {
          dial: w.dial,
          ...(typeof w.gte === 'number' ? { gte: w.gte } : {}),
          ...(typeof w.lte === 'number' ? { lte: w.lte } : {}),
        },
        weight,
      }]
    }
    return []
  })
}
