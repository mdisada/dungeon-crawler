// Loop Classifier boundary rules (F08 SS3): the LLM assesses, these functions decide. The
// classifier never executes - confidence thresholds map to proposal handling per mode, and the
// deterministic mismatch streak decides when the classifier runs at all.

import type { LoopType } from './types.ts'
import { LOOP_TYPES } from './types.ts'

/** 3+ consecutive off-loop intents raise the Router mismatch flag (F08 SS3). */
export const MISMATCH_THRESHOLD = 3

/** Confidence gates (F08 SS3): propose at 0.65; full-AI auto-accepts only at 0.8. */
export const PIVOT_PROPOSE_CONFIDENCE = 0.65
export const PIVOT_AUTO_CONFIDENCE = 0.8

/** After a mid-band pivot (0.65-0.8, full-AI), keep the current loop and re-check in 5 events. */
export const PIVOT_REEVALUATE_EVENTS = 5

export interface PivotAssessment {
  assessment: 'on_loop' | 'pivot'
  confidence: number
  pivot: {
    newType: LoopType
    why: string
    suggestedFirstBeat: string
    actionOnCurrent: 'suspend' | 'complete'
  } | null
}

const ON_LOOP: PivotAssessment = { assessment: 'on_loop', confidence: 0, pivot: null }

/** Boundary parser - anything malformed degrades to on_loop (never a false pivot). */
export function parsePivot(raw: unknown): PivotAssessment {
  if (typeof raw !== 'object' || raw === null) return ON_LOOP
  const obj = raw as Record<string, unknown>
  const confidence = Math.max(0, Math.min(1, Number(obj.confidence) || 0))
  if (obj.assessment !== 'pivot') return { ...ON_LOOP, confidence }
  const pivot = (typeof obj.pivot === 'object' && obj.pivot !== null ? obj.pivot : {}) as Record<string, unknown>
  const newType = LOOP_TYPES.find((t) => t === pivot.new_type)
  if (!newType) return ON_LOOP
  return {
    assessment: 'pivot',
    confidence,
    pivot: {
      newType,
      why: typeof pivot.why === 'string' ? pivot.why : '',
      suggestedFirstBeat: typeof pivot.suggested_first_beat === 'string' ? pivot.suggested_first_beat : '',
      actionOnCurrent: pivot.action_on_current === 'complete' ? 'complete' : 'suspend',
    },
  }
}

export type PivotHandling = 'auto_accept' | 'wait_and_reevaluate' | 'propose' | 'none'

/** F08 SS3 policy: assist always proposes; full-AI is conservative between the bands. */
export function pivotHandling(mode: 'full_ai' | 'assist' | null, assessment: PivotAssessment): PivotHandling {
  if (assessment.assessment !== 'pivot' || !assessment.pivot) return 'none'
  if (assessment.confidence < PIVOT_PROPOSE_CONFIDENCE) return 'none'
  if (mode === 'full_ai') {
    return assessment.confidence >= PIVOT_AUTO_CONFIDENCE ? 'auto_accept' : 'wait_and_reevaluate'
  }
  return 'propose'
}

/** Streak arithmetic for dm.story.offLoopStreak; negative values are the re-evaluate cooldown. */
export function nextStreak(previous: number, isOffLoopIntent: boolean): number {
  if (previous < 0) return previous + 1 // cooling down after a mid-band pivot
  return isOffLoopIntent ? previous + 1 : 0
}

export function streakTriggersClassifier(streak: number): boolean {
  return streak >= MISMATCH_THRESHOLD
}
