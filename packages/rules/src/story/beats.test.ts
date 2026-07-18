import { describe, expect, it } from 'vitest'

import { parseBeatPlan } from './beats.ts'

const ctx = { partySize: 2, partySkills: ['athletics', 'stealth', 'persuasion'] }

const validBeat = {
  beat: {
    name: 'the_hunt',
    goals: ['Track the beast to its lair before nightfall', 'Keep the wounded guide alive'],
    exit_conditions: { any: [{ flag: 'beast_found', eq: true }, { event: 'party entered the lair' }] },
    ingredient_requests: [{ type: 'clue', purpose: 'tracks that reveal the beast is wounded', pillar_tags: ['exploration'] }],
    braided: [{ goal_pair: [0, 1], link: { kind: 'dc_mod' }, skills: ['athletics', 'stealth'] }],
    narration_seed: 'The trail bends into the treeline; somewhere ahead, the guide coughs blood.',
  },
}

describe('parseBeatPlan', () => {
  it('parses a full beat with predicate exits and a braided pair', () => {
    const result = parseBeatPlan(validBeat, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.goals).toHaveLength(2)
    expect(result.plan.braided).toHaveLength(1)
    expect(result.dropped).toEqual([])
  })

  it('rejects invalid exit predicates (same atoms as F04)', () => {
    const bad = JSON.parse(JSON.stringify(validBeat)) as typeof validBeat
    bad.beat.exit_conditions = { whenever: true } as never
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(false)
  })

  it('drops braided pairs for solo parties instead of failing the beat', () => {
    const result = parseBeatPlan(validBeat, { partySize: 1, partySkills: ctx.partySkills })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.braided).toEqual([])
    expect(result.dropped.some((d) => d.includes('solo'))).toBe(true)
  })

  it('drops braided pairs needing skills the party lacks (composition gate, F08 SS10)', () => {
    const bad = JSON.parse(JSON.stringify(validBeat)) as typeof validBeat
    bad.beat.braided[0].skills = ['arcana', 'stealth']
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.braided).toEqual([])
    expect(result.dropped.some((d) => d.includes('arcana'))).toBe(true)
  })

  it('drops braided pairs with out-of-range goal indexes', () => {
    const bad = JSON.parse(JSON.stringify(validBeat)) as typeof validBeat
    bad.beat.braided[0].goal_pair = [0, 5]
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.braided).toEqual([])
  })

  it('requires name, goals, and narration seed', () => {
    const result = parseBeatPlan({ beat: { goals: [] } }, ctx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(3)
  })
})
