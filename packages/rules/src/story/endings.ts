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
  /**
   * The last objective on the ladder - the climax. Optional so legacy callers keep the old
   * behaviour exactly; when supplied it enables the contradiction veto below.
   */
  climaxObjectiveId?: string
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
    // 'alive' means present and not dead - NOT "anything but dead". The old check counted an
    // ABSENT npc (one who has left the scene) as alive, and also refused a never-recorded npc
    // (undefined) the alive default the rest of the engine gives it. Live 2026-07-24, heist: the
    // party won every objective and secured the manifest, but the boss Valerius ended 'absent',
    // the alive signals fired anyway (-3 on the triumph ending, +3 on the tragedy), and a
    // DEFEAT ending committed over "Justice Served" 3 to 2. Absent and dead are both "not alive".
    if (when.state === 'alive') return state !== 'dead' && state !== 'absent'
    return state === when.state
  }
  const value = world.dialValues[when.dial]
  if (value === undefined) return false
  if (when.gte !== undefined && !(value >= when.gte)) return false
  if (when.lte !== undefined && !(value <= when.lte)) return false
  return when.gte !== undefined || when.lte !== undefined
}

/**
 * Which objectives does this ending claim went a way the story refuted? (2026-07-27)
 *
 * `signalHolds` has no notion of a refuted signal - a false one simply contributes nothing, so a
 * positively-weighted {objective_id, outcome} costs an ending only its own weight when it turns out
 * false, and side signals can carry it home anyway. Live 2026-07-27, The Lantern of Saltmarsh
 * Reach: the climax objective resolved `failed`, yet "The Light Restored" - whose top signal reads
 * "The party stopped Maren and saved the Lindworm at the climax" - won 7 to 5 over the tragedy
 * whose {climax, failed} signal actually fired. The player was handed a restoration they had not
 * achieved. No weighting fixes that: a contradicted ending's side-signal total is unbounded above.
 *
 * Deliberately narrow in two ways:
 * - POSITIVE signals only. A tragedy that carries {climax, completed, weight: -4} is describing
 *   what would ARGUE AGAINST it, not claiming it happened.
 * - GROUPED per objective. An ending legitimately allowed to carry both {obj, completed} and
 *   {obj, failed} (stage 8 permits it, and "The Keeper Consumed" did) is never refuted on that
 *   objective - one of its claims holds.
 *
 * Unrecorded is not refuted: an objective still in play has no entry in `objectiveOutcomes`, and
 * that must never count, or an early pass would disqualify the whole field.
 */
function refutedObjectiveIds(candidate: EndingCandidate, world: EndingWorld): Set<string> {
  const claimed = new Map<string, Set<string>>()
  for (const signal of candidate.signals) {
    if (signal.weight <= 0 || !('objective_id' in signal.when)) continue
    const outcomes = claimed.get(signal.when.objective_id) ?? new Set<string>()
    outcomes.add(signal.when.outcome)
    claimed.set(signal.when.objective_id, outcomes)
  }
  const refuted = new Set<string>()
  for (const [objectiveId, outcomes] of claimed) {
    const actual = world.objectiveOutcomes[objectiveId]
    if (actual && !outcomes.has(actual)) refuted.add(objectiveId)
  }
  return refuted
}

export interface EndingScores {
  scores: Record<string, number>
  /** Never null while candidates exist - ties break by lowest index (no dead-end). */
  leadingId: string | null
  /** Endings whose CLIMAX claim was refuted by what actually happened - ineligible outright. */
  contradictedIds: string[]
  /** True when EVERY candidate was contradicted, so the veto was stood down to avoid a dead end. */
  vetoFallback: boolean
  /** How many objectives each ending claims went a way the story refuted. The first sort key. */
  refutedCounts: Record<string, number>
  /** Scores of the endings that can still win - the surviving field's best accuracy tier. */
  eligibleScores: Record<string, number>
}

/**
 * Rank the endings (F08 SS8.1), in three tiers.
 *
 * 1. VETO on the climax. An ending whose climax claim is refuted cannot win at all: the climax is
 *    what an ending is ABOUT, and handing the player a restoration they did not achieve is the
 *    defect this whole rule exists for.
 * 2. FEWEST refuted objectives. Objective outcomes are what the party actually DID, so no amount
 *    of NPC-state and dial arithmetic may outvote them. Weights are authored by an LLM in [-5, 5]
 *    with nothing enforcing that objectives outweigh dials, so leaving this to the sum left the
 *    finale resting on whatever numbers the model happened to write. Counting REFUTATIONS rather
 *    than rewarding true claims is deliberate: the defect is claiming what did not happen, and
 *    ranking by true-claim count instead would simply favour whichever ending listed more
 *    objectives.
 * 3. WEIGHTED SCORE, then index. Within one accuracy tier the world's texture - who lived, who
 *    sided with the party, how they played - picks the winner, exactly as before.
 *
 * A mid-ladder objective that went the other way is ordinary story variance, which is why tier 2
 * ranks rather than vetoes: a blanket per-objective veto would disqualify the triumph ending over
 * a single early stumble and empty the field on any mixed-outcome run.
 */
export function scoreEndings(candidates: EndingCandidate[], world: EndingWorld): EndingScores {
  const scores: Record<string, number> = {}
  const refutedCounts: Record<string, number> = {}
  const refutedByEnding = new Map<string, Set<string>>()
  for (const candidate of candidates) {
    scores[candidate.id] = candidate.signals.reduce(
      (sum, signal) => (signalHolds(signal.when, world) ? sum + signal.weight : sum),
      0,
    )
    const refuted = refutedObjectiveIds(candidate, world)
    refutedByEnding.set(candidate.id, refuted)
    refutedCounts[candidate.id] = refuted.size
  }
  const climaxId = world.climaxObjectiveId
  const contradictedIds = climaxId
    ? candidates.filter((c) => refutedByEnding.get(c.id)?.has(climaxId)).map((c) => c.id)
    : []
  const contradicted = new Set(contradictedIds)
  const eligible = candidates.filter((c) => !contradicted.has(c.id))
  // Every ending refuted: an authoring accident, not a reason to strand the story with no finale.
  // Stand the veto down and rank the whole field, exactly as before this rule existed.
  const vetoFallback = eligible.length === 0
  const field = vetoFallback ? candidates : eligible
  // Only the best accuracy tier can win, so the commitment margin is judged inside it. Comparing
  // across tiers would stall commitment forever whenever a refuted ending outscores the truthful
  // leader - which is precisely the situation tier 2 exists to handle.
  const bestRefuted = Math.min(...field.map((c) => refutedCounts[c.id] ?? 0))
  const tier = field.filter((c) => (refutedCounts[c.id] ?? 0) === bestRefuted)
  const leading = [...tier].sort((a, b) => {
    const diff = (scores[b.id] ?? 0) - (scores[a.id] ?? 0)
    return diff !== 0 ? diff : a.index - b.index
  })[0]
  const eligibleScores = Object.fromEntries(tier.map((c) => [c.id, scores[c.id] ?? 0]))
  return { scores, leadingId: leading?.id ?? null, contradictedIds, vetoFallback, refutedCounts, eligibleScores }
}

/** Commitment gate (F08 SS8.1): decisive margin + enough recorded play, near the climax. */
export const COMMIT_MIN_MARGIN = 3
export const COMMIT_MIN_EVENTS = 30
/** At or below this, "one objective left" is still Act 1 - a one-shot ladder is 3-4 rungs. */
export const SHORT_LADDER_MAX = 4

export interface ObjectiveLadder {
  total: number
  remaining: number
}

/**
 * "Near the climax" measured against the ladder's own length. On a long ladder one open
 * objective is the finale; on a one-shot's 3-4 it can be the second scene, so nothing commits
 * until the ladder is actually finished.
 */
export function ladderReady(ladder: ObjectiveLadder): boolean {
  if (ladder.total <= 0) return false
  return ladder.total <= SHORT_LADDER_MAX ? ladder.remaining === 0 : ladder.remaining <= 1
}

export function commitmentReady(
  scoresByEnding: Record<string, number>,
  leadingId: string | null,
  eventCount: number,
  ladder: ObjectiveLadder,
): boolean {
  if (!leadingId || eventCount < COMMIT_MIN_EVENTS) return false
  if (!ladderReady(ladder)) return false
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
