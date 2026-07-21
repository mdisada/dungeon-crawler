import { describe, expect, it } from 'vitest'

import { parseBeatPlan } from './beats.ts'

const ctx = { partySize: 2, partySkills: ['athletics', 'stealth', 'persuasion'], milestones: ['guide_saved'] }

const validBeat = {
  beat: {
    name: 'the_hunt',
    goals: ['Track the beast to its lair before nightfall', 'Keep the wounded guide alive'],
    exit_conditions: { any: [{ flag: 'beast_found', eq: true }, { event: 'party entered the lair' }] },
    ingredient_requests: [{ type: 'clue', purpose: 'tracks that reveal the beast is wounded', pillar_tags: ['exploration'] }],
    braided: [{ goal_pair: [0, 1], link: { kind: 'dc_mod' }, skills: ['athletics', 'stealth'] }],
    narration_seed: 'The trail bends into the treeline; somewhere ahead, the guide coughs blood.',
    encounter: {
      kind: 'skill_challenge',
      label: 'The chase through the treeline',
      stakes: 'Lose the trail and the guide bleeds out',
      rationale: 'physical pursuit',
      on_success: ['beast_found'],
      on_partial: ['party entered the lair'],
      on_failure: [],
    },
  },
}

const clone = () => JSON.parse(JSON.stringify(validBeat)) as typeof validBeat

describe('parseBeatPlan', () => {
  it('parses a full beat with predicate exits, a braided pair, and an encounter spec', () => {
    const result = parseBeatPlan(validBeat, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.goals).toHaveLength(2)
    expect(result.plan.braided).toHaveLength(1)
    expect(result.plan.encounter?.kind).toBe('skill_challenge')
    expect(result.plan.encounter?.onSuccess).toEqual(['beast_found'])
    expect(result.dropped).toEqual([])
  })

  it('rejects invalid exit predicates (same atoms as F04)', () => {
    const bad = clone()
    bad.beat.exit_conditions = { whenever: true } as never
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(false)
  })

  it('drops braided pairs for solo parties instead of failing the beat', () => {
    const result = parseBeatPlan(validBeat, { ...ctx, partySize: 1 })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.braided).toEqual([])
    expect(result.dropped.some((d) => d.includes('solo'))).toBe(true)
  })

  it('drops braided pairs needing skills the party lacks (composition gate, F08 SS10)', () => {
    const bad = clone()
    bad.beat.braided[0].skills = ['arcana', 'stealth']
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.braided).toEqual([])
    expect(result.dropped.some((d) => d.includes('arcana'))).toBe(true)
  })

  it('drops braided pairs with out-of-range goal indexes', () => {
    const bad = clone()
    bad.beat.braided[0].goal_pair = [0, 5]
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.braided).toEqual([])
  })

  it('requires name, goals, narration seed, and an encounter spec', () => {
    const result = parseBeatPlan({ beat: { goals: [] } }, ctx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('accepts outcome maps drawn from the objective vocabulary too', () => {
    const withObjective = clone()
    withObjective.beat.encounter.on_success = ['guide_saved']
    const result = parseBeatPlan(withObjective, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.encounter?.onSuccess).toEqual(['guide_saved'])
  })

  it('never lets an inexact atom become a real outcome map', () => {
    const bad = clone()
    bad.beat.encounter.on_success = ['Beast_Found']
    const result = parseBeatPlan(bad, ctx)
    // Dropped, not honoured - and with nothing left in on_success the beat cannot move the
    // spine, so this specific case is still fatal.
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('on_success'))).toBe(true)
  })

  it('rejects a spec whose on_success maps nothing despite available vocabulary', () => {
    const bad = clone()
    bad.beat.encounter.on_success = []
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(false)
  })

  it('rejects unknown encounter kinds', () => {
    const bad = clone()
    ;(bad.beat.encounter as { kind: string }).kind = 'boss_fight'
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(false)
  })

  it('allows empty outcome maps when there is no vocabulary at all', () => {
    const sparse = {
      beat: {
        name: 'drift',
        goals: ['Decide where to go next'],
        narration_seed: 'The road forks.',
        encounter: { kind: 'combat', label: 'Roadside ambush', stakes: '', on_success: [], on_partial: [], on_failure: [] },
      },
    }
    const result = parseBeatPlan(sparse, { partySize: 2, partySkills: [] })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.encounter?.onSuccess).toEqual([])
  })
})

describe('outcome maps degrade instead of killing the beat', () => {
  // Live 2026-07-21: the planner wrote "The cult silenced Elara before she could reveal the
  // truth" into on_failure. Hard-failing there left the loop with no active beat, which
  // starved the scene ledger of vocabulary and stalled progression entirely.
  const ctx = { partySize: 1, partySkills: ['investigation'], milestones: ['study_secured'] }
  const plan = (encounter: Record<string, unknown>) => ({
    beat: {
      name: 'The Locked Study',
      goals: ['find the way in'],
      exit_conditions: { flag: 'study_secured', eq: true },
      narration_seed: 'The study door is bolted from inside.',
      encounter,
    },
  })

  it('drops an invented milestone but keeps the beat', () => {
    const result = parseBeatPlan(plan({
      kind: 'skill_challenge',
      label: 'Force the study',
      on_success: ['study_secured'],
      on_failure: ['The cult silenced Elara before she could reveal the truth'],
    }), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.encounter?.onSuccess).toEqual(['study_secured'])
    expect(result.plan.encounter?.onFailure).toEqual([])
    expect(result.dropped.some((d) => d.includes('not authored'))).toBe(true)
  })

  it('still fails when success maps onto nothing - that cannot move the spine', () => {
    const result = parseBeatPlan(plan({
      kind: 'skill_challenge',
      label: 'Force the study',
      on_success: ['something invented'],
    }), ctx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('on_success'))).toBe(true)
  })
})
