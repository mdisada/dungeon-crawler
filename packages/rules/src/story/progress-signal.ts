// What counts as PROGRESS for the Progress Director (2026-07-26).
//
// The director resets its stall counters whenever it sees progress, so this predicate decides
// when the escalation ladder is allowed to notice that a story has stopped moving.
//
// It used to accept any `encounter_opened` / `encounter_resolved` / `scene_travel`, and counted
// `entry_mapped: adhoc` explicitly. Every one of those fires for content that credits NOTHING: an
// ad-hoc micro-encounter (empty outcome maps by design) and a random danger spawn both look
// exactly like the story advancing. Live in the heist run, only 3 of 13 encounter resolutions came
// from the authored graph - the other ten were ad-hoc and random - and the ladder never once
// escalated, because each of them reset the counter. The party churned in generated filler for
// ~50 turns and the component whose entire job is noticing that never saw it.
//
// The rule now: the SPINE must move. Playing is welcome; it just is not progress unless it
// advanced the authored story. An authored node's own encounter still counts (that IS the spine
// being played), which is what keeps a party legitimately mid-encounter from being nagged - and
// the director separately floors its gentle rungs while any encounter is open.

export interface ProgressEvent {
  type: string
  payload?: Record<string, unknown> | null
}

/** Events that always mean the authored story moved. */
const SPINE_TYPES = new Set([
  'milestone_reached',
  'beat_exit_met',
  'objective_completed',
  'objective_revealed',
  'offer_accepted',
  'ingredient_revealed',
])

const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

export function isSpineProgress(event: ProgressEvent): boolean {
  const p = event.payload ?? {}
  if (SPINE_TYPES.has(event.type)) return true

  // An encounter resolution counts only when it was the AUTHORED node's (it carries node_key) or
  // it actually credited something. An ad-hoc resolution with empty outcome maps is not progress.
  if (event.type === 'encounter_resolved') {
    return typeof p.node_key === 'string' || asArray(p.milestones).length > 0
  }

  // A successful attempt inside an encounter is real forward motion within a scene being played.
  if (event.type === 'encounter_attempt') {
    return p.success === true || p.result === 'solves'
  }

  // Committing to the OFFERED encounter is engagement with the spine. `adhoc` deliberately is not:
  // it is the escape valve, and treating it as progress is what let the valve run the whole story.
  if (event.type === 'entry_mapped') return p.entry === 'offered'

  return false
}

/** True when any event in the window moved the spine. */
export function progressedSince(events: readonly ProgressEvent[]): boolean {
  return events.some(isSpineProgress)
}
