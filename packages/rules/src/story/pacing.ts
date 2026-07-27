// Pacing & difficulty profile (2026-07-27): the one place that turns a difficulty preset into
// every number the runtime actually reads.
//
// Before this, `adventures.difficulty_setting.preset` reached exactly one thing - the combat XP
// budget in stage 5 - while every non-combat pacing number was a hardcoded module constant. An
// "Easy" adventure and a "Deadly" one had the identical stuck-scene timeout, the identical check
// DCs, and the identical objective time limit. The preset was a label on a box that changed
// nothing outside a fight.
//
// The contract: presets own the full profile, the user may override any single knob, and this
// module REPAIRS the result so no combination of overrides can break the escalation ladder. The
// UI never computes a threshold - it renders `PACING_KNOBS` and calls `resolvePacing`.

export const DIFFICULTY_PRESETS = ['easy', 'standard', 'hard', 'deadly'] as const
export type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number]

/**
 * Every tunable non-combat number, flat. Grouped for presentation by `PACING_KNOBS`, not here -
 * the runtime wants one lookup, not a nested walk.
 */
export interface PacingProfile {
  // --- when the DM steps in (Progress Director thresholds, in no-progress turns) ---
  nudge: number
  reveal: number
  replanBeat: number
  guaranteedRoute: number
  failForward: number
  offerPressure: number
  /**
   * Turns of drift an NPC will tolerate before starting to steer the conversation back (2026-07-27).
   *
   * The first rung of the whole pacing ladder and the gentlest thing on it - one person declining
   * to follow a tangent, in character. It sits BELOW `nudge` deliberately: a party that is merely
   * chatting should meet an in-fiction shrug long before the DM starts narrating hints at them.
   */
  deflect: number
  // --- the second clock: plain turns on one objective, which player churn cannot reset ---
  guaranteedRouteOnObjective: number
  failForwardOnObjective: number
  // --- how hard individual scenes are ---
  /** Added to every adjudicated check DC before the server clamp. */
  dcShift: number
  /** Added to a skill challenge's authored `needed_successes`. */
  successBias: number
  /** Added to `max_failures` (challenges) and `max_attempts` (puzzles). */
  failureBias: number
  // --- how hostile the world is between scenes ---
  /** Added to a location's danger score before the spawn roll. */
  dangerBias: number
}

/**
 * The four presets, fully specified. Read down a column to see what a difficulty actually means.
 *
 * Direction of travel: harder = the DM waits longer before helping, checks are stiffer, there is
 * less room for error, the world pushes back more, and an objective is written off sooner. Easy
 * inverts all five.
 */
export const DIFFICULTY_PROFILES: Record<DifficultyPreset, PacingProfile> = {
  easy: {
    deflect: 4,
    nudge: 2, reveal: 3, replanBeat: 4, guaranteedRoute: 7, failForward: 12, offerPressure: 3,
    guaranteedRouteOnObjective: 18, failForwardOnObjective: 50,
    dcShift: -2, successBias: -1, failureBias: 1, dangerBias: -2,
  },
  standard: {
    deflect: 3,
    nudge: 2, reveal: 4, replanBeat: 6, guaranteedRoute: 9, failForward: 15, offerPressure: 3,
    guaranteedRouteOnObjective: 25, failForwardOnObjective: 40,
    dcShift: 0, successBias: 0, failureBias: 0, dangerBias: 0,
  },
  hard: {
    deflect: 3,
    nudge: 3, reveal: 6, replanBeat: 8, guaranteedRoute: 14, failForward: 18, offerPressure: 4,
    guaranteedRouteOnObjective: 26, failForwardOnObjective: 35,
    dcShift: 2, successBias: 0, failureBias: -1, dangerBias: 1,
  },
  deadly: {
    deflect: 2,
    nudge: 4, reveal: 8, replanBeat: 10, guaranteedRoute: 20, failForward: 22, offerPressure: 5,
    guaranteedRouteOnObjective: 24, failForwardOnObjective: 30,
    dcShift: 3, successBias: 1, failureBias: -1, dangerBias: 2,
  },
}

export type PacingKnobKey = keyof PacingProfile
export type PacingOverrides = Partial<Record<PacingKnobKey, number>>

export type PacingGroup = 'pressure' | 'challenge' | 'world'

export interface PacingKnob {
  key: PacingKnobKey
  group: PacingGroup
  /** Plain-language name. Never the code identifier - nobody outside this repo knows what a "rung" is. */
  label: string
  /** One sentence, concrete, in the second person. Rendered verbatim under the control. */
  help: string
  min: number
  max: number
  /** How the value reads on its own ("6 turns", "+2"). */
  unit: 'turns' | 'delta'
}

export const PACING_GROUP_LABELS: Record<PacingGroup, { title: string; blurb: string }> = {
  pressure: {
    title: 'When the DM steps in',
    blurb: 'How long the party is left to work something out before the story pushes them along.',
  },
  challenge: {
    title: 'How hard scenes are',
    blurb: 'The dice targets and the margin for error inside a single encounter.',
  },
  world: {
    title: 'How hostile the world is',
    blurb: 'What happens between scenes, when the party travels or makes noise.',
  },
}

/**
 * The advanced panel's contents, in display order. `failForward` and `guaranteedRouteOnObjective`
 * are deliberately absent: both are secondary clocks that only make sense alongside the two limits
 * that ARE shown, and exposing four interacting timeouts is how a settings screen stops being read.
 * They still move with the preset, and `resolvePacing` keeps them consistent with any override.
 */
export const PACING_KNOBS: readonly PacingKnob[] = [
  {
    key: 'deflect', group: 'pressure', label: 'Small-talk allowance', min: 1, max: 15, unit: 'turns',
    help: 'Turns the party can spend off-task before NPCs start steering the conversation back - in character, in their own words. The gentlest nudge there is.',
  },
  {
    key: 'nudge', group: 'pressure', label: 'Hint delay', min: 1, max: 20, unit: 'turns',
    help: 'Turns without progress before the DM re-frames what is already in front of the party. No new information is given.',
  },
  {
    key: 'reveal', group: 'pressure', label: 'Clue delay', min: 1, max: 25, unit: 'turns',
    help: 'Turns without progress before the DM works an undiscovered clue into the scene as something the party notices.',
  },
  {
    key: 'replanBeat', group: 'pressure', label: 'Stuck-scene timeout', min: 2, max: 30, unit: 'turns',
    help: 'Turns without progress before an ally cuts in and moves the party on. The current attempt is marked failed, so it costs something.',
  },
  {
    key: 'guaranteedRoute', group: 'pressure', label: 'Rescue-route delay', min: 3, max: 40, unit: 'turns',
    help: 'Turns without progress before the DM opens a route that is guaranteed to finish the objective. The party still has to play it.',
  },
  {
    key: 'failForwardOnObjective', group: 'pressure', label: 'Objective time limit', min: 10, max: 60, unit: 'turns',
    help: 'Total turns one objective may hold the story before it is written off as failed and the plot moves on without it. Nothing the party does resets this.',
  },
  {
    key: 'offerPressure', group: 'pressure', label: 'Quest-hook patience', min: 1, max: 20, unit: 'turns',
    help: 'Turns an unanswered quest offer may sit before the person who made it presses the party for an answer.',
  },
  {
    key: 'dcShift', group: 'challenge', label: 'Check difficulty', min: -4, max: 5, unit: 'delta',
    help: 'Added to the target number of every skill check. +2 turns a coin-flip check into one the party will usually miss.',
  },
  {
    key: 'successBias', group: 'challenge', label: 'Successes needed', min: -2, max: 2, unit: 'delta',
    help: 'Changes how many successes each skill challenge asks for. -1 makes every challenge one step shorter.',
  },
  {
    key: 'failureBias', group: 'challenge', label: 'Room for error', min: -2, max: 2, unit: 'delta',
    help: 'Changes how many failed attempts a challenge or puzzle allows before it is lost. +1 buys the party one more mistake.',
  },
  {
    key: 'dangerBias', group: 'world', label: 'Random encounters', min: -3, max: 3, unit: 'delta',
    help: 'Shifts how often travelling, resting, or making noise attracts trouble. -2 makes the world close to safe between scenes.',
  },
]

const KNOB_BY_KEY = new Map(PACING_KNOBS.map((k) => [k.key, k]))

/** Hard bounds for knobs the panel does not show, so a stored profile can never go absurd. */
const HIDDEN_BOUNDS: Record<'failForward' | 'guaranteedRouteOnObjective', { min: number; max: number }> = {
  failForward: { min: 3, max: 45 },
  guaranteedRouteOnObjective: { min: 5, max: 59 },
}

const clamp = (n: number, min: number, max: number) => Math.max(min, Math.min(max, Math.round(n)))

export function isDifficultyPreset(value: unknown): value is DifficultyPreset {
  return typeof value === 'string' && (DIFFICULTY_PRESETS as readonly string[]).includes(value)
}

/**
 * Preset + overrides -> a profile the runtime can use blind.
 *
 * Repair, not rejection. The escalation ladder requires its five silence thresholds to be
 * non-decreasing (`decideDirector` walks them top-down and would otherwise skip rungs), and the
 * rescue clock must land before the write-off clock or the rescue rung is unreachable on the
 * objective timer. A settings screen that let a user express either of those would produce an
 * adventure that quietly loses a rung - so the ordering is enforced here, once, rather than
 * validated in the UI and hoped for everywhere else.
 */
export function resolvePacing(
  preset: DifficultyPreset | null,
  overrides: PacingOverrides = {},
): PacingProfile {
  const base = DIFFICULTY_PROFILES[preset ?? 'standard']
  const merged: PacingProfile = { ...base }

  for (const [rawKey, rawValue] of Object.entries(overrides)) {
    const key = rawKey as PacingKnobKey
    if (!(key in base) || typeof rawValue !== 'number' || !Number.isFinite(rawValue)) continue
    const knob = KNOB_BY_KEY.get(key)
    const bounds = knob ?? HIDDEN_BOUNDS[key as keyof typeof HIDDEN_BOUNDS]
    if (!bounds) continue
    merged[key] = clamp(rawValue, bounds.min, bounds.max)
  }

  // The silence ladder, weakest rung first: each rung must be reachable, so each threshold is
  // pushed to at least its predecessor. Editing "hint delay" upward therefore drags the rungs
  // above it rather than silently disabling them.
  // `deflect` is deliberately NOT on this ladder. The rungs below are the DM's escalating
  // interventions and each must stay reachable above the last; an NPC declining to follow a
  // tangent is a different mechanism that happens to read the same counter, and forcing it into
  // the ordering dragged `nudge` up to meet it and corrupted every preset.
  const ladder: PacingKnobKey[] = ['nudge', 'reveal', 'replanBeat', 'guaranteedRoute', 'failForward']
  for (let i = 1; i < ladder.length; i++) {
    const prev = merged[ladder[i - 1]]
    if (merged[ladder[i]] < prev) merged[ladder[i]] = prev
  }

  // The objective clock: the rescue must get a turn before the objective is written off.
  merged.failForwardOnObjective = Math.max(merged.failForwardOnObjective, 10)
  if (merged.guaranteedRouteOnObjective >= merged.failForwardOnObjective) {
    merged.guaranteedRouteOnObjective = Math.max(5, merged.failForwardOnObjective - 4)
  }

  return merged
}

/** Only what differs from the preset, so changing preset re-derives cleanly instead of stacking. */
export function pacingOverrides(
  preset: DifficultyPreset | null,
  profile: PacingProfile,
): PacingOverrides {
  const base = DIFFICULTY_PROFILES[preset ?? 'standard']
  const diff: PacingOverrides = {}
  for (const key of Object.keys(base) as PacingKnobKey[]) {
    if (profile[key] !== base[key]) diff[key] = profile[key]
  }
  return diff
}

export function hasPacingOverrides(overrides: PacingOverrides | null | undefined): boolean {
  return Boolean(overrides && Object.keys(overrides).length > 0)
}

/** "6 turns" / "+2" / "0" - the value as the panel shows it. */
export function formatKnobValue(knob: PacingKnob, value: number): string {
  if (knob.unit === 'turns') return `${value} ${value === 1 ? 'turn' : 'turns'}`
  return value > 0 ? `+${value}` : String(value)
}

/** Worst case turns one objective can hold the story under this profile. */
export function worstCaseObjectiveTurns(profile: PacingProfile): number {
  return profile.failForwardOnObjective + 1
}

// --- applying the challenge knobs -------------------------------------------------------------
// The engines stay preset-blind: they clamp their own inputs and are fed already-shifted numbers.

/** Authored `needed_successes` shifted by the profile; never below 1. */
export function biasedSuccesses(authored: number, profile: PacingProfile): number {
  return Math.max(1, Math.round(authored) + profile.successBias)
}

/** Authored `max_failures` / `max_attempts` shifted by the profile; never below 1. */
export function biasedFailures(authored: number, profile: PacingProfile): number {
  return Math.max(1, Math.round(authored) + profile.failureBias)
}

/** Adjudicated DC shifted by the profile. The server's own DC_MIN/DC_MAX clamp still applies after. */
export function biasedDc(dc: number, profile: PacingProfile): number {
  return Math.round(dc) + profile.dcShift
}

/** Location danger shifted by the profile, before the 0-10 clamp `dangerScore` applies. */
export function biasedDangerBase(base: number, profile: PacingProfile): number {
  return Math.max(0, Math.round(base) + profile.dangerBias)
}
