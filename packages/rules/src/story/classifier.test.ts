import { describe, expect, it } from 'vitest'

import {
  MISMATCH_THRESHOLD, nextStreak, parsePivot, pivotHandling, streakTriggersClassifier,
} from './classifier.ts'
import { intentPillar, isOffLoop } from './templates.ts'

describe('mismatch streak (deterministic classifier trigger)', () => {
  it('three consecutive off-loop intents trigger the classifier; an on-loop intent resets', () => {
    let streak = 0
    streak = nextStreak(streak, true)
    streak = nextStreak(streak, true)
    expect(streakTriggersClassifier(streak)).toBe(false)
    streak = nextStreak(streak, true)
    expect(streak).toBe(MISMATCH_THRESHOLD)
    expect(streakTriggersClassifier(streak)).toBe(true)
    expect(nextStreak(streak, false)).toBe(0)
  })

  it('the re-evaluate cooldown counts back up through negatives', () => {
    let streak = -5
    for (let i = 0; i < 5; i++) streak = nextStreak(streak, true)
    expect(streak).toBe(0)
    expect(streakTriggersClassifier(streak)).toBe(false)
  })

  it('pillar tagging: combat verbs, social says, exploratory everything-else', () => {
    expect(intentPillar('attack')).toBe('combat')
    expect(intentPillar('say')).toBe('social')
    expect(intentPillar('do')).toBe('exploration')
    expect(isOffLoop('combat', 'intrigue')).toBe(true)
    expect(isOffLoop('social', 'intrigue')).toBe(false)
  })
})

describe('parsePivot (boundary parser)', () => {
  const pivotRaw = {
    assessment: 'pivot',
    confidence: 0.9,
    pivot: { new_type: 'siege_defense', why: 'players are barricading', suggested_first_beat: 'preparation', action_on_current: 'suspend' },
  }

  it('parses a well-formed pivot', () => {
    const result = parsePivot(pivotRaw)
    expect(result.assessment).toBe('pivot')
    expect(result.pivot?.newType).toBe('siege_defense')
  })

  it('degrades malformed output to on_loop (no false pivots from junk)', () => {
    expect(parsePivot(null).assessment).toBe('on_loop')
    expect(parsePivot({ assessment: 'pivot', confidence: 0.9, pivot: { new_type: 'sitcom' } }).assessment).toBe('on_loop')
    expect(parsePivot({ assessment: 'pivot', confidence: 'very' }).assessment).toBe('on_loop')
  })

  it('clamps confidence into [0, 1]', () => {
    expect(parsePivot({ ...pivotRaw, confidence: 7 }).confidence).toBe(1)
  })
})

describe('pivotHandling policy (F08 SS3)', () => {
  const at = (confidence: number) => parsePivot({
    assessment: 'pivot', confidence,
    pivot: { new_type: 'siege_defense', why: '', suggested_first_beat: '', action_on_current: 'suspend' },
  })

  it('full-AI: auto-accept at >= 0.8, wait between 0.65 and 0.8, ignore below', () => {
    expect(pivotHandling('full_ai', at(0.85))).toBe('auto_accept')
    expect(pivotHandling('full_ai', at(0.7))).toBe('wait_and_reevaluate')
    expect(pivotHandling('full_ai', at(0.5))).toBe('none')
  })

  it('assist: proposes at >= 0.65, never auto-accepts', () => {
    expect(pivotHandling('assist', at(0.9))).toBe('propose')
    expect(pivotHandling('assist', at(0.7))).toBe('propose')
    expect(pivotHandling('assist', at(0.5))).toBe('none')
  })

  it('on_loop never produces a handling', () => {
    expect(pivotHandling('full_ai', parsePivot({ assessment: 'on_loop', confidence: 0.99 }))).toBe('none')
  })
})
