import { describe, expect, it } from 'vitest'

import {
  applyDialNudge, COMMIT_MIN_EVENTS, commitmentReady, ladderReady, parseEndingSignals, scoreEndings,
} from './endings.ts'
import type { EndingCandidate, EndingWorld } from './endings.ts'

const candidates: EndingCandidate[] = [
  {
    id: 'song-ended', index: 0,
    signals: [
      { when: { objective_id: 'obj-1', outcome: 'completed' }, weight: 3 },
      { when: { npc_id: 'maren', state: 'allied' }, weight: 2 },
    ],
  },
  {
    id: 'village-dreams', index: 1,
    signals: [
      { when: { objective_id: 'obj-1', outcome: 'failed' }, weight: 4 },
      { when: { dial: 'mercy', lte: -2 }, weight: 2 },
    ],
  },
]

const world = (over: Partial<EndingWorld> = {}): EndingWorld => ({
  objectiveOutcomes: {},
  npcStates: {},
  dialValues: {},
  ...over,
})

describe('scoreEndings (deterministic argmax, F08 SS8.1)', () => {
  it('ranks candidates from objective outcomes + NPC states + dial values', () => {
    const { scores, leadingId } = scoreEndings(candidates, world({
      objectiveOutcomes: { 'obj-1': 'completed' },
      npcStates: { maren: 'allied' },
    }))
    expect(scores['song-ended']).toBe(5)
    expect(scores['village-dreams']).toBe(0)
    expect(leadingId).toBe('song-ended')
  })

  it('a player action that flips the winning signal re-ranks the leading ending', () => {
    const before = scoreEndings(candidates, world({ objectiveOutcomes: { 'obj-1': 'completed' } }))
    expect(before.leadingId).toBe('song-ended')
    const after = scoreEndings(candidates, world({
      objectiveOutcomes: { 'obj-1': 'failed' },
      dialValues: { mercy: -3 },
    }))
    expect(after.leadingId).toBe('village-dreams')
  })

  it('ties break by lowest index - one always leads, no dead-end', () => {
    const { leadingId } = scoreEndings(candidates, world())
    expect(leadingId).toBe('song-ended')
  })

  it('negative weights counter-indicate', () => {
    const counter: EndingCandidate[] = [
      { id: 'a', index: 0, signals: [{ when: { npc_id: 'maren', state: 'dead' }, weight: -3 }] },
      { id: 'b', index: 1, signals: [{ when: { npc_id: 'maren', state: 'dead' }, weight: 2 }] },
    ]
    const { leadingId } = scoreEndings(counter, world({ npcStates: { maren: 'dead' } }))
    expect(leadingId).toBe('b')
  })
})

describe('dial nudges', () => {
  it('clamps deltas to +/-2 and values to [-5, 5]', () => {
    expect(applyDialNudge(0, 5)).toBe(2)
    expect(applyDialNudge(4, 2)).toBe(5)
    expect(applyDialNudge(-5, -2)).toBe(-5)
    expect(applyDialNudge(1, -1)).toBe(0)
  })
})

describe('commitmentReady (late + decisive only)', () => {
  const longLadder = { total: 8, remaining: 1 }

  it('requires the margin, a positive leader, and enough recorded play', () => {
    expect(commitmentReady({ a: 5, b: 1 }, 'a', COMMIT_MIN_EVENTS, longLadder)).toBe(true)
    expect(commitmentReady({ a: 5, b: 3 }, 'a', COMMIT_MIN_EVENTS, longLadder)).toBe(false)
    expect(commitmentReady({ a: 5, b: 1 }, 'a', COMMIT_MIN_EVENTS - 1, longLadder)).toBe(false)
    expect(commitmentReady({ a: 0, b: 0 }, 'a', COMMIT_MIN_EVENTS, longLadder)).toBe(false)
  })

  it('will not commit off a short ladder until every objective is done', () => {
    expect(commitmentReady({ a: 5, b: 1 }, 'a', COMMIT_MIN_EVENTS, { total: 3, remaining: 1 })).toBe(false)
    expect(commitmentReady({ a: 5, b: 1 }, 'a', COMMIT_MIN_EVENTS, { total: 3, remaining: 0 })).toBe(true)
  })
})

describe('ladderReady (how late is late)', () => {
  it('measures "near the climax" against the ladder\'s own length', () => {
    // A one-shot's 3-4 objectives: one left can still be Act 1.
    expect(ladderReady({ total: 4, remaining: 1 })).toBe(false)
    expect(ladderReady({ total: 4, remaining: 0 })).toBe(true)
    // A long campaign ladder: one left IS the finale.
    expect(ladderReady({ total: 9, remaining: 1 })).toBe(true)
    expect(ladderReady({ total: 9, remaining: 2 })).toBe(false)
    expect(ladderReady({ total: 0, remaining: 0 })).toBe(false)
  })
})

describe('parseEndingSignals (closed vocabulary)', () => {
  it('keeps well-formed signals and drops junk', () => {
    const signals = parseEndingSignals({
      summary: 's',
      signals: [
        { when: { objective_id: 'o1', outcome: 'completed' }, weight: 2 },
        { when: { npc_id: 'n1', state: 'hostile' }, weight: -1 },
        { when: { dial: 'mercy', gte: 3 }, weight: 1 },
        { when: { free_flag: 'nope' }, weight: 5 },
        { when: { dial: 'mercy' }, weight: 1 },
        { weight: 3 },
      ],
    })
    expect(signals).toHaveLength(3)
  })
})
