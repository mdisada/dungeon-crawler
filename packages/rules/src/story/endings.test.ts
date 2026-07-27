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

describe('alive means present and not dead (2026-07-24)', () => {
  // The live failure: a triumph ending penalized "villain alive" and a defeat ending rewarded
  // it; the villain ended ABSENT (defeated, left the scene), the alive signals fired on both,
  // and the DEFEAT ending won over the victory despite every objective completing.
  const villainEndings: EndingCandidate[] = [
    { id: 'justice', index: 0, signals: [
      { when: { objective_id: 'obj-1', outcome: 'completed' }, weight: 5 },
      { when: { npc_id: 'boss', state: 'alive' }, weight: -3 },
    ] },
    { id: 'tragedy', index: 1, signals: [
      { when: { objective_id: 'obj-1', outcome: 'failed' }, weight: 5 },
      { when: { npc_id: 'boss', state: 'alive' }, weight: 3 },
    ] },
  ]

  it('an ABSENT boss is not alive - the victory wins', () => {
    const { leadingId } = scoreEndings(villainEndings, world({
      objectiveOutcomes: { 'obj-1': 'completed' }, npcStates: { boss: 'absent' },
    }))
    expect(leadingId).toBe('justice')
  })

  it('a DEAD boss is not alive either', () => {
    const s = scoreEndings(villainEndings, world({
      objectiveOutcomes: { 'obj-1': 'completed' }, npcStates: { boss: 'dead' },
    }))
    expect(s.scores.justice).toBe(5)
    expect(s.scores.tragedy).toBe(0)
  })

  it('a boss who is genuinely alive DOES fire the signal', () => {
    const s = scoreEndings(villainEndings, world({
      objectiveOutcomes: { 'obj-1': 'completed' }, npcStates: { boss: 'alive' },
    }))
    expect(s.scores.justice).toBe(2) // 5 - 3
    expect(s.scores.tragedy).toBe(3)
  })

  it('an unrecorded npc counts as alive (the engine-wide default)', () => {
    const s = scoreEndings(villainEndings, world({ objectiveOutcomes: { 'obj-1': 'completed' } }))
    expect(s.scores.justice).toBe(2) // alive signal fires on undefined -> -3
  })
})

describe('a contradicted climax cannot land the ending (2026-07-27)', () => {
  // The Lantern of Saltmarsh Reach, verbatim: the climax objective resolved `failed`, yet the
  // restoration ending outscored the tragedy 7 to 5 on side signals alone.
  const CLIMAX = 'climax'
  const saltmarsh: EndingCandidate[] = [
    {
      id: 'light-restored', index: 0,
      signals: [
        { when: { objective_id: CLIMAX, outcome: 'completed' }, weight: 5 },
        { when: { objective_id: 'evidence-a', outcome: 'completed' }, weight: 2 },
        { when: { objective_id: 'evidence-b', outcome: 'completed' }, weight: 2 },
        { when: { dial: 'force_at_the_tower', gte: 2 }, weight: 3 },
      ],
    },
    {
      id: 'next-wreck', index: 1,
      signals: [{ when: { objective_id: CLIMAX, outcome: 'failed' }, weight: 5 }],
    },
  ]
  const played: EndingWorld = {
    objectiveOutcomes: { 'evidence-a': 'completed', 'evidence-b': 'completed' },
    npcStates: {},
    dialValues: { force_at_the_tower: 2 },
    climaxObjectiveId: CLIMAX,
  }

  it('the ending that claims a climax the party failed cannot lead', () => {
    const s = scoreEndings(saltmarsh, { ...played, objectiveOutcomes: { ...played.objectiveOutcomes, [CLIMAX]: 'failed' } })
    expect(s.leadingId).toBe('next-wreck')
    expect(s.contradictedIds).toEqual(['light-restored'])
    expect(s.vetoFallback).toBe(false)
    // The raw score is untouched - only eligibility moved, so stored ending_scores stay comparable.
    expect(s.scores['light-restored']).toBe(7)
  })

  it('the commitment margin is judged on the eligible field', () => {
    const s = scoreEndings(saltmarsh, { ...played, objectiveOutcomes: { ...played.objectiveOutcomes, [CLIMAX]: 'failed' } })
    const ladder = { total: 3, remaining: 0 }
    expect(commitmentReady(s.scores, s.leadingId, COMMIT_MIN_EVENTS, ladder)).toBe(false)
    expect(commitmentReady(s.eligibleScores, s.leadingId, COMMIT_MIN_EVENTS, ladder)).toBe(true)
  })

  it('an unresolved climax never vetoes - unrecorded is not refuted', () => {
    const s = scoreEndings(saltmarsh, played)
    expect(s.contradictedIds).toEqual([])
    expect(s.leadingId).toBe('light-restored')
    expect(s.vetoFallback).toBe(false)
  })

  it('a NEGATIVE climax signal is an argument against, not a claim', () => {
    const tragedy: EndingCandidate[] = [
      { id: 'grim', index: 0, signals: [{ when: { objective_id: CLIMAX, outcome: 'completed' }, weight: -4 }] },
    ]
    const s = scoreEndings(tragedy, { ...played, objectiveOutcomes: { [CLIMAX]: 'completed' } })
    expect(s.contradictedIds).toEqual([])
  })

  it('an ending covering BOTH climax branches is never vetoed', () => {
    const both: EndingCandidate[] = [
      {
        id: 'keeper-consumed', index: 0,
        signals: [
          { when: { objective_id: CLIMAX, outcome: 'completed' }, weight: 2 },
          { when: { objective_id: CLIMAX, outcome: 'failed' }, weight: 2 },
        ],
      },
    ]
    for (const outcome of ['completed', 'failed'] as const) {
      expect(scoreEndings(both, { ...played, objectiveOutcomes: { [CLIMAX]: outcome } }).contradictedIds).toEqual([])
    }
  })

  it('a MID-LADDER contradiction is ordinary variance, not a veto', () => {
    const s = scoreEndings(saltmarsh, {
      ...played,
      objectiveOutcomes: { 'evidence-a': 'failed', 'evidence-b': 'completed' },
    })
    expect(s.contradictedIds).toEqual([])
  })

  it('when every ending is refuted the veto stands down rather than stranding the story', () => {
    const allClaimVictory: EndingCandidate[] = [
      { id: 'a', index: 0, signals: [{ when: { objective_id: CLIMAX, outcome: 'completed' }, weight: 5 }, { when: { dial: 'force_at_the_tower', gte: 2 }, weight: 1 }] },
      { id: 'b', index: 1, signals: [{ when: { objective_id: CLIMAX, outcome: 'completed' }, weight: 5 }] },
    ]
    const s = scoreEndings(allClaimVictory, { ...played, objectiveOutcomes: { [CLIMAX]: 'failed' } })
    expect(s.vetoFallback).toBe(true)
    expect(s.leadingId).toBe('a')
    expect(s.contradictedIds).toEqual(['a', 'b'])
  })

  it('no climaxObjectiveId means the old behaviour, exactly', () => {
    const s = scoreEndings(saltmarsh, {
      objectiveOutcomes: { ...played.objectiveOutcomes, [CLIMAX]: 'failed' },
      npcStates: {},
      dialValues: { force_at_the_tower: 2 },
    })
    expect(s.leadingId).toBe('light-restored')
    expect(s.contradictedIds).toEqual([])
  })
})
