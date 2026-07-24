import { describe, expect, it } from 'vitest'

import { parseBeatPlan, parseOutcomeMaps } from './beats.ts'

const ctx = { partySize: 2, partySkills: ['athletics', 'stealth', 'persuasion'], milestones: ['guide_saved'] }

const validBeat = {
  beat: {
    name: 'the_hunt',
    goals: ['Track the beast to its lair before nightfall', 'Keep the wounded guide alive'],
    new_local_atoms: [
      { name: 'beast_found', kind: 'flag' },
      { name: 'party entered the lair', kind: 'event' },
    ],
    exit_conditions: { any: [{ flag: 'beast_found', eq: true }, { event: 'party entered the lair' }] },
    ingredient_requests: [{ type: 'clue', purpose: 'tracks that reveal the beast is wounded', pillar_tags: ['exploration'] }],
    braided: [{ goal_pair: [0, 1], link: { kind: 'dc_mod' }, skills: ['athletics', 'stealth'] }],
    narration_seed: 'The trail bends into the treeline; somewhere ahead, the guide coughs blood.',
    encounter: {
      kind: 'skill_challenge',
      label: 'The chase through the treeline',
      stakes: 'Lose the trail and the guide bleeds out',
      rationale: 'physical pursuit',
    },
  },
}

const clone = () => JSON.parse(JSON.stringify(validBeat)) as typeof validBeat

describe('parseBeatPlan (call 1: plan + declared atoms + encounter shell)', () => {
  it('parses a full beat with declared atoms, predicate exits, a braided pair, and a shell', () => {
    const result = parseBeatPlan(validBeat, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.goals).toHaveLength(2)
    expect(result.plan.braided).toHaveLength(1)
    expect(result.plan.localAtoms).toEqual([
      { name: 'beast_found', kind: 'flag' },
      { name: 'party entered the lair', kind: 'event' },
    ])
    expect(result.plan.encounter?.kind).toBe('skill_challenge')
    // Outcome maps belong to call 2 - the shell always starts empty.
    expect(result.plan.encounter?.onSuccess).toEqual([])
    expect(result.dropped).toEqual([])
  })

  it('rejects exit atoms that are neither declared nor objective milestones', () => {
    const bad = clone()
    bad.beat.new_local_atoms = []
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('declare'))).toBe(true)
  })

  it('accepts exits on objective milestones without declaration', () => {
    const objectiveOnly = clone()
    objectiveOnly.beat.new_local_atoms = []
    objectiveOnly.beat.exit_conditions = { flag: 'guide_saved', eq: true } as never
    const result = parseBeatPlan(objectiveOnly, ctx)
    expect(result.ok).toBe(true)
  })

  it('matches declarations canonically - case/punctuation variants pass', () => {
    const variant = clone()
    variant.beat.new_local_atoms = [
      { name: 'Beast Found!', kind: 'flag' },
      { name: 'party entered the lair', kind: 'event' },
    ]
    const result = parseBeatPlan(variant, ctx)
    expect(result.ok).toBe(true)
  })

  it('coerces a bare flag atom to eq:true instead of killing the beat', () => {
    // Live 2026-07-23: two beat_planner_failures in one run, both "a flag atom needs eq" -
    // and a failed plan degrades to a null-encounter beat the party cannot play.
    const bare = clone()
    bare.beat.exit_conditions = { any: [{ flag: 'beast_found' }, { event: 'party entered the lair' }] } as never
    const result = parseBeatPlan(bare, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.exitConditions).toEqual({
      any: [{ flag: 'beast_found', eq: true }, { event: 'party entered the lair' }],
    })
  })

  it('never flips a deliberate eq:false', () => {
    const explicit = clone()
    explicit.beat.new_local_atoms = [{ name: 'alarm_raised', kind: 'flag' }, { name: 'beast_found', kind: 'flag' }]
    explicit.beat.exit_conditions = { any: [{ flag: 'alarm_raised', eq: false }, { flag: 'beast_found' }] } as never
    const result = parseBeatPlan(explicit, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.exitConditions).toEqual({
      any: [{ flag: 'alarm_raised', eq: false }, { flag: 'beast_found', eq: true }],
    })
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

  it('requires name, goals, narration seed, and an encounter shell', () => {
    const result = parseBeatPlan({ beat: { goals: [] } }, ctx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.length).toBeGreaterThanOrEqual(4)
  })

  it('rejects unknown encounter kinds', () => {
    const bad = clone()
    ;(bad.beat.encounter as { kind: string }).kind = 'boss_fight'
    const result = parseBeatPlan(bad, ctx)
    expect(result.ok).toBe(false)
  })

  it('drops malformed atom declarations instead of failing', () => {
    const messy = clone()
    ;(messy.beat.new_local_atoms as unknown[]) = [
      { name: 'beast_found', kind: 'flag' },
      { name: 'party entered the lair', kind: 'event' },
      { name: '', kind: 'flag' },
      { kind: 'flag' },
      { name: 'x', kind: 'banner' },
    ]
    const result = parseBeatPlan(messy, ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.plan.localAtoms).toHaveLength(2)
  })
})

describe('parseOutcomeMaps (call 2: closed-menu tier mapping)', () => {
  const menu = ['guide_saved', 'beast_found', 'party entered the lair']

  it('keeps exact menu atoms and preserves order without duplicates', () => {
    const maps = parseOutcomeMaps({
      on_success: ['guide_saved', 'guide_saved', 'beast_found'],
      on_partial: ['party entered the lair'],
      on_failure: [],
    }, menu)
    expect(maps.onSuccess).toEqual(['guide_saved', 'beast_found'])
    expect(maps.onPartial).toEqual(['party entered the lair'])
    expect(maps.onFailure).toEqual([])
    expect(maps.dropped).toEqual([])
  })

  it('canonically repairs case/punctuation variants to menu atoms', () => {
    const maps = parseOutcomeMaps({ on_success: ['Beast_Found', 'Party entered the lair.'] }, menu)
    expect(maps.onSuccess).toEqual(['beast_found', 'party entered the lair'])
  })

  it('drops invented prose instead of honouring it', () => {
    // Live 2026-07-21: "The cult silenced Elara before she could reveal the truth" in on_failure.
    const maps = parseOutcomeMaps({
      on_success: ['guide_saved'],
      on_failure: ['The cult silenced Elara before she could reveal the truth'],
    }, menu)
    expect(maps.onSuccess).toEqual(['guide_saved'])
    expect(maps.onFailure).toEqual([])
    expect(maps.dropped.some((d) => d.includes('not on the menu'))).toBe(true)
  })

  it('an empty on_success is the CALLER\'s problem (deterministic spine fallback), not fatal', () => {
    const maps = parseOutcomeMaps({ on_success: ['something invented'] }, menu)
    expect(maps.onSuccess).toEqual([])
    expect(maps.dropped).toHaveLength(1)
  })

  it('tolerates garbage input', () => {
    expect(parseOutcomeMaps(null, menu).onSuccess).toEqual([])
    expect(parseOutcomeMaps('prose', menu).onSuccess).toEqual([])
  })
})
