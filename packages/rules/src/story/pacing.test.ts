import { describe, expect, it } from 'vitest'

import { DEFAULT_DIRECTOR_THRESHOLDS } from './director'
import {
  biasedDangerBase, biasedDc, biasedFailures, biasedSuccesses, DIFFICULTY_PRESETS,
  DIFFICULTY_PROFILES, formatKnobValue, hasPacingOverrides, isDifficultyPreset, PACING_KNOBS,
  pacingOverrides, resolvePacing, worstCaseObjectiveTurns,
} from './pacing'
import type { PacingKnobKey, PacingProfile } from './pacing'

const LADDER: PacingKnobKey[] = ['nudge', 'reveal', 'replanBeat', 'guaranteedRoute', 'failForward']

function expectWellFormed(profile: PacingProfile) {
  for (let i = 1; i < LADDER.length; i++) {
    expect(profile[LADDER[i]]).toBeGreaterThanOrEqual(profile[LADDER[i - 1]])
  }
  expect(profile.guaranteedRouteOnObjective).toBeLessThan(profile.failForwardOnObjective)
}

describe('presets', () => {
  it('every preset is a usable ladder', () => {
    for (const preset of DIFFICULTY_PRESETS) expectWellFormed(DIFFICULTY_PROFILES[preset])
  })

  it('standard reproduces the shipped director defaults exactly', () => {
    // The preset layer must be a no-op for the difficulty everyone already plays, or introducing
    // it silently re-tunes every existing adventure.
    const standard = DIFFICULTY_PROFILES.standard
    for (const key of Object.keys(DEFAULT_DIRECTOR_THRESHOLDS) as (keyof typeof DEFAULT_DIRECTOR_THRESHOLDS)[]) {
      expect(standard[key], key).toBe(DEFAULT_DIRECTOR_THRESHOLDS[key])
    }
    expect(standard.dcShift).toBe(0)
    expect(standard.successBias).toBe(0)
    expect(standard.failureBias).toBe(0)
    expect(standard.dangerBias).toBe(0)
  })

  it('difficulty moves monotonically in the direction it claims', () => {
    const [easy, standard, hard, deadly] = DIFFICULTY_PRESETS.map((p) => DIFFICULTY_PROFILES[p])
    // Harder = the DM waits longer to help.
    for (const key of ['nudge', 'reveal', 'replanBeat', 'guaranteedRoute'] as PacingKnobKey[]) {
      expect(easy[key], key).toBeLessThanOrEqual(standard[key])
      expect(standard[key], key).toBeLessThanOrEqual(hard[key])
      expect(hard[key], key).toBeLessThanOrEqual(deadly[key])
    }
    // Harder = an objective is written off sooner.
    expect(easy.failForwardOnObjective).toBeGreaterThan(standard.failForwardOnObjective)
    expect(standard.failForwardOnObjective).toBeGreaterThan(hard.failForwardOnObjective)
    expect(hard.failForwardOnObjective).toBeGreaterThan(deadly.failForwardOnObjective)
    // Harder = stiffer checks, less room for error, a more hostile world.
    expect(easy.dcShift).toBeLessThan(standard.dcShift)
    expect(hard.dcShift).toBeGreaterThan(standard.dcShift)
    expect(easy.failureBias).toBeGreaterThan(hard.failureBias)
    expect(easy.dangerBias).toBeLessThan(deadly.dangerBias)
  })

  it('bounds every adventure - even Easy finishes an objective', () => {
    for (const preset of DIFFICULTY_PRESETS) {
      expect(worstCaseObjectiveTurns(DIFFICULTY_PROFILES[preset])).toBeLessThanOrEqual(61)
    }
  })
})

describe('resolvePacing', () => {
  it('a null preset plays as standard', () => {
    expect(resolvePacing(null)).toEqual(DIFFICULTY_PROFILES.standard)
  })

  it('applies a single override and leaves the rest on the preset', () => {
    const profile = resolvePacing('standard', { replanBeat: 4 })
    expect(profile.replanBeat).toBe(4)
    expect(profile.dcShift).toBe(DIFFICULTY_PROFILES.standard.dcShift)
  })

  it('clamps an override to the knob bounds rather than rejecting it', () => {
    expect(resolvePacing('standard', { dcShift: 99 }).dcShift).toBe(5)
    expect(resolvePacing('standard', { dcShift: -99 }).dcShift).toBe(-4)
    expect(resolvePacing('standard', { nudge: 0 }).nudge).toBe(1)
  })

  it('ignores unknown keys and non-numbers', () => {
    const profile = resolvePacing('standard', {
      bogus: 5, nudge: Number.NaN, reveal: 'x',
    } as unknown as Record<PacingKnobKey, number>)
    expect(profile).toEqual(DIFFICULTY_PROFILES.standard)
  })

  it('repairs a ladder the user inverted, so no rung becomes unreachable', () => {
    // A user drags "hint delay" past every rung above it. Left alone, decideDirector would walk
    // top-down and skip reveal/replan entirely.
    const profile = resolvePacing('standard', { nudge: 12 })
    expect(profile.nudge).toBe(12)
    expect(profile.reveal).toBeGreaterThanOrEqual(12)
    expect(profile.replanBeat).toBeGreaterThanOrEqual(12)
    expectWellFormed(profile)
  })

  it('keeps the rescue clock ahead of the write-off clock', () => {
    const profile = resolvePacing('standard', { failForwardOnObjective: 15 })
    expect(profile.failForwardOnObjective).toBe(15)
    expect(profile.guaranteedRouteOnObjective).toBeLessThan(15)
    expectWellFormed(profile)
  })

  it('every knob, pushed to both bounds, still yields a well-formed profile', () => {
    for (const knob of PACING_KNOBS) {
      for (const value of [knob.min, knob.max]) {
        for (const preset of DIFFICULTY_PRESETS) {
          expectWellFormed(resolvePacing(preset, { [knob.key]: value }))
        }
      }
    }
  })

  it('is idempotent - resolving a resolved profile changes nothing', () => {
    const once = resolvePacing('hard', { nudge: 9 })
    expect(resolvePacing('hard', once)).toEqual(once)
  })
})

describe('pacingOverrides', () => {
  it('is empty when nothing was changed', () => {
    const diff = pacingOverrides('hard', DIFFICULTY_PROFILES.hard)
    expect(diff).toEqual({})
    expect(hasPacingOverrides(diff)).toBe(false)
  })

  it('records only what differs, so switching preset re-derives cleanly', () => {
    const profile = resolvePacing('easy', { dcShift: 1 })
    const diff = pacingOverrides('easy', profile)
    expect(diff).toEqual({ dcShift: 1 })
    // The same override carried onto a different preset picks up that preset's other numbers.
    expect(resolvePacing('deadly', diff).replanBeat).toBe(DIFFICULTY_PROFILES.deadly.replanBeat)
  })

  it('round-trips', () => {
    const profile = resolvePacing('hard', { replanBeat: 12, dangerBias: -1 })
    expect(resolvePacing('hard', pacingOverrides('hard', profile))).toEqual(profile)
  })
})

describe('knob metadata', () => {
  it('every knob names a real profile field and has a sane range', () => {
    for (const knob of PACING_KNOBS) {
      expect(DIFFICULTY_PROFILES.standard).toHaveProperty(knob.key)
      expect(knob.min).toBeLessThan(knob.max)
      expect(knob.label.length).toBeGreaterThan(0)
      expect(knob.help.length).toBeGreaterThan(20)
      // The panel is read by players, not engineers: no identifiers in the copy.
      expect(knob.help).not.toContain('_')
      expect(knob.label).not.toContain('_')
    }
  })

  it('every preset value sits inside its knob bounds', () => {
    for (const preset of DIFFICULTY_PRESETS) {
      for (const knob of PACING_KNOBS) {
        const value = DIFFICULTY_PROFILES[preset][knob.key]
        expect(value, `${preset}.${knob.key}`).toBeGreaterThanOrEqual(knob.min)
        expect(value, `${preset}.${knob.key}`).toBeLessThanOrEqual(knob.max)
      }
    }
  })

  it('has no duplicate keys', () => {
    expect(new Set(PACING_KNOBS.map((k) => k.key)).size).toBe(PACING_KNOBS.length)
  })

  it('formats values the way the panel reads them', () => {
    const turns = PACING_KNOBS.find((k) => k.unit === 'turns')!
    const delta = PACING_KNOBS.find((k) => k.unit === 'delta')!
    expect(formatKnobValue(turns, 6)).toBe('6 turns')
    expect(formatKnobValue(turns, 1)).toBe('1 turn')
    expect(formatKnobValue(delta, 2)).toBe('+2')
    expect(formatKnobValue(delta, 0)).toBe('0')
    expect(formatKnobValue(delta, -2)).toBe('-2')
  })
})

describe('applying the challenge knobs', () => {
  const easy = DIFFICULTY_PROFILES.easy
  const deadly = DIFFICULTY_PROFILES.deadly

  it('shifts authored challenge counts but never below 1', () => {
    expect(biasedSuccesses(3, easy)).toBe(2)
    expect(biasedSuccesses(1, easy)).toBe(1)
    expect(biasedSuccesses(3, deadly)).toBe(4)
    expect(biasedFailures(2, easy)).toBe(3)
    expect(biasedFailures(1, deadly)).toBe(1)
  })

  it('shifts DCs before the server clamp', () => {
    expect(biasedDc(12, easy)).toBe(10)
    expect(biasedDc(12, deadly)).toBe(15)
    expect(biasedDc(12, DIFFICULTY_PROFILES.standard)).toBe(12)
  })

  it('shifts danger without going negative', () => {
    expect(biasedDangerBase(3, easy)).toBe(1)
    expect(biasedDangerBase(1, easy)).toBe(0)
    expect(biasedDangerBase(3, deadly)).toBe(5)
  })
})

describe('isDifficultyPreset', () => {
  it('accepts the four presets and nothing else', () => {
    for (const preset of DIFFICULTY_PRESETS) expect(isDifficultyPreset(preset)).toBe(true)
    expect(isDifficultyPreset('nightmare')).toBe(false)
    expect(isDifficultyPreset(null)).toBe(false)
    expect(isDifficultyPreset(3)).toBe(false)
  })
})
