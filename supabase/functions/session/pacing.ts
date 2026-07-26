// The adventure's difficulty/pacing profile at runtime (2026-07-27).
//
// `adventures.difficulty_setting` used to reach exactly one thing - the combat XP budget in guide
// stage 5 - so an "Easy" adventure and a "Deadly" one shared the identical stuck-scene timeout,
// check DCs, and objective time limit. The creator picks a preset (and optionally moves individual
// knobs) in the wizard; this is where that choice becomes numbers the engines read.
//
// Resolved ONCE at session start into `dm.settings.pacing`, because every consumer sits on a hot
// path: the director runs each turn, the challenge seeds run on every encounter open. One state
// read beats a table hit plus a re-derivation in all of them.

import { resolvePacing } from '../_shared/story/index.ts'
import type { PacingOverrides, PacingProfile } from '../_shared/story/index.ts'
import { isDifficultyPreset, PACING_KNOBS } from '../_shared/story/index.ts'
import { dmSettings } from '../_shared/play/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'

const KNOB_KEYS = new Set<string>(PACING_KNOBS.map((knob) => knob.key))

interface DifficultySetting {
  preset?: unknown
  pacing?: unknown
}

/**
 * Turn a stored `difficulty_setting` into a full profile. Unknown keys and non-numbers are dropped
 * rather than rejected - a malformed column must not stop a session from starting, and
 * `resolvePacing` clamps and repairs whatever survives.
 */
export function profileFromSetting(setting: Json | null | undefined): PacingProfile {
  const row = (setting ?? {}) as DifficultySetting
  const preset = isDifficultyPreset(row.preset) ? row.preset : null
  const overrides: PacingOverrides = {}
  if (row.pacing && typeof row.pacing === 'object' && !Array.isArray(row.pacing)) {
    for (const [key, value] of Object.entries(row.pacing as Record<string, unknown>)) {
      if (KNOB_KEYS.has(key) && typeof value === 'number' && Number.isFinite(value)) {
        overrides[key as keyof PacingOverrides] = value
      }
    }
  }
  return resolvePacing(preset, overrides)
}

/**
 * The profile in force. Falls back to Standard for any adventure whose session predates this -
 * which is every existing one, and is exactly the pre-change behaviour, since Standard's numbers
 * are asserted equal to the old hardcoded defaults (see pacing.test.ts).
 */
export function pacingFor(state: GameState): PacingProfile {
  return dmSettings(state).pacing ?? resolvePacing(null)
}
