import { describe, expect, it } from 'vitest'

import { atomsSatisfy, buildGuaranteedRoute, minimalSatisfyingAtoms } from './guaranteed-route'
import { buildRescueNode } from './stages/stage5-nodes'
import { ENCOUNTER_TEMPLATES } from '../story/templates-encounter'

describe('minimalSatisfyingAtoms', () => {
  it('a bare flag atom', () => {
    expect(minimalSatisfyingAtoms({ flag: 'lantern_relit', eq: true })).toEqual(['lantern_relit'])
  })
  it('an event atom', () => {
    expect(minimalSatisfyingAtoms({ event: 'party entered the crypt' })).toEqual(['party entered the crypt'])
  })
  it('any -> the CHEAPEST branch, not the first', () => {
    const predicate = {
      any: [
        { all: [{ flag: 'a', eq: true }, { flag: 'b', eq: true }] },
        { flag: 'c', eq: true },
      ],
    }
    expect(minimalSatisfyingAtoms(predicate)).toEqual(['c'])
  })
  it('all -> the full union, deduped', () => {
    const predicate = { all: [{ flag: 'a', eq: true }, { flag: 'b', eq: true }, { flag: 'a', eq: true }] }
    expect(minimalSatisfyingAtoms(predicate)).toEqual(['a', 'b'])
  })
  it('the real Sunken Chapel predicates', () => {
    expect(minimalSatisfyingAtoms({
      all: [{ eq: true, flag: 'study_examined' }, { event: 'party_examined_study' }],
    })).toEqual(['study_examined', 'party_examined_study'])
    expect(minimalSatisfyingAtoms({
      any: [
        { eq: true, flag: 'killer_identified_and_apprehended' },
        { eq: true, flag: 'killer_escaped_justice' },
      ],
    })).toEqual(['killer_identified_and_apprehended'])
  })
  // These three encoded the old rule - that an eq:false clause could never be satisfied, since
  // nothing writes a flag false. That rule is what left "Reach Oakhaven" with no rescue AND no
  // way to complete at all (live 2026-07-23). An unset flag now reads false, so absence
  // satisfies the clause for free.
  it('eq:false atoms are satisfied by absence, at a cost of no atoms', () => {
    expect(minimalSatisfyingAtoms({ flag: 'alarm_raised', eq: false })).toEqual([])
    // The free branch is the cheapest, so an any-chain takes it over a one-atom branch.
    expect(minimalSatisfyingAtoms({
      any: [{ flag: 'alarm_raised', eq: false }, { flag: 'door_opened', eq: true }],
    })).toEqual([])
  })
  it('an all-chain with a negative branch pays only for the positive half', () => {
    expect(minimalSatisfyingAtoms({
      all: [{ flag: 'a', eq: true }, { flag: 'alarm_raised', eq: false }],
    })).toEqual(['a'])
  })
  it('an eq against a value absence cannot supply is still unsatisfiable', () => {
    expect(minimalSatisfyingAtoms({ fact: 'npc.x.status', eq: 'dead' })).toBeNull()
    expect(minimalSatisfyingAtoms({ all: [{ flag: 'a', eq: true }, { fact: 'n', eq: 3 }] })).toBeNull()
  })
  it('garbage in, null out', () => {
    expect(minimalSatisfyingAtoms(null)).toBeNull()
    expect(minimalSatisfyingAtoms('prose')).toBeNull()
    expect(minimalSatisfyingAtoms({ any: [] })).toBeNull()
  })
})

describe('the core property: a guaranteed route actually completes its objective', () => {
  const predicates = [
    { flag: 'a', eq: true },
    { event: 'the gate fell' },
    { all: [{ flag: 'a', eq: true }, { event: 'e1' }] },
    { any: [{ flag: 'a', eq: true }, { flag: 'b', eq: true }] },
    { any: [{ all: [{ flag: 'a', eq: true }, { flag: 'b', eq: true }] }, { flag: 'c', eq: true }] },
    { all: [{ any: [{ flag: 'x', eq: true }, { flag: 'y', eq: true }] }, { event: 'e2' }] },
  ]

  // Satisfied from turn zero: `p` is unset, so the objective is already complete and wants no
  // rescue. buildGuaranteedRoute returns null for these by design - a route that awards nothing
  // is not a route. (An objective in this shape is an authoring bug of its own - it is the
  // phantom-completion smell - but that belongs to the reachability lint, not here.)
  const freeFromTheStart = [
    { any: [{ flag: 'p', eq: false }, { flag: 'q', eq: true }] },
    { flag: 'alarm_raised', eq: false },
  ]

  it('every satisfiable predicate yields atoms that evaluate true', () => {
    for (const predicate of predicates) {
      const atoms = minimalSatisfyingAtoms(predicate)
      expect(atoms, JSON.stringify(predicate)).not.toBeNull()
      expect(atomsSatisfy(predicate, atoms!), JSON.stringify(predicate)).toBe(true)
    }
  })

  it('and so does every route the builder ships', () => {
    predicates.forEach((completionPredicates, i) => {
      const route = buildGuaranteedRoute({
        objectiveId: `objective-${i}`, title: `Objective ${i}`, completionPredicates,
      })
      expect(route).not.toBeNull()
      expect(atomsSatisfy(completionPredicates, route!.onSuccess)).toBe(true)
    })
  })

  it('predicates already true at the start award nothing, but still get their terminal scene', () => {
    for (const predicate of freeFromTheStart) {
      expect(minimalSatisfyingAtoms(predicate), JSON.stringify(predicate)).toEqual([])
      expect(atomsSatisfy(predicate, []), JSON.stringify(predicate)).toBe(true)
      // The rescue is the ladder's terminal now, not a predicate-satisfying device: an objective
      // whose predicate is free still needs the scene that resolves it.
      const route = buildGuaranteedRoute({
        objectiveId: 'o', title: 'Already true', completionPredicates: predicate,
      })
      expect(route, JSON.stringify(predicate)).not.toBeNull()
      expect(route!.onSuccess).toEqual([])
    }
  })
})

describe('buildGuaranteedRoute', () => {
  const input = {
    objectiveId: 'obj-1',
    title: 'Relight the Greywater lantern',
    hiddenDescription: 'The keeper was dragged into the sea-caves by wreckers.',
    completionPredicates: { all: [{ flag: 'lantern_relit', eq: true }] },
  }

  it('carries a real template and one of that template\'s twists', () => {
    const route = buildGuaranteedRoute(input)!
    const template = ENCOUNTER_TEMPLATES.find((t) => t.key === route.template)!
    expect(template).toBeDefined()
    expect(template.kind).toBe('skill_challenge')
    expect(template.twists).toContain(route.twist)
    expect(route.guidance).toContain('Twist')
  })

  it('is deterministic per objective, and differs across objectives', () => {
    expect(buildGuaranteedRoute(input)!.template).toBe(buildGuaranteedRoute(input)!.template)
    const shapes = new Set(
      Array.from({ length: 8 }, (_, i) =>
        buildGuaranteedRoute({ ...input, objectiveId: `obj-${i}` })!.template),
    )
    expect(shapes.size).toBeGreaterThan(1)
  })

  it('never credits the objective on a partial or a failure', () => {
    const route = buildGuaranteedRoute(input)!
    expect(route.onPartial).toEqual([])
    expect(route.onFailure).toEqual([])
  })

  it('still builds when the predicate cannot be satisfied by writing atoms', () => {
    // This returned null until 2026-07-27, on the reasoning that a rescue which cannot complete
    // the objective is worse than none. The rescue is the terminal scene now - the one that
    // resolves the objective whichever way it goes - so an objective without one has no floor.
    const route = buildGuaranteedRoute({ ...input, completionPredicates: { flag: 'x', eq: false } })
    expect(route).not.toBeNull()
    expect(route!.onSuccess).toEqual([])
  })
})

describe('negative clauses cost nothing (2026-07-23)', () => {
  it('an all-chain with a deadline clause still yields a route', () => {
    // Previously null: the eq:false branch was treated as unsatisfiable, so the whole chain
    // was, so "Reach Oakhaven" shipped with no rescue at all.
    const route = buildGuaranteedRoute({
      objectiveId: 'o-oakhaven',
      title: 'Reach Oakhaven',
      completionPredicates: {
        all: [{ flag: 'elara_reached_oakhaven', eq: true }, { flag: 'eight_days_passed', eq: false }],
      },
    })
    expect(route).not.toBeNull()
    expect(route?.onSuccess).toEqual(['elara_reached_oakhaven'])
    expect(atomsSatisfy(
      { all: [{ flag: 'elara_reached_oakhaven', eq: true }, { flag: 'eight_days_passed', eq: false }] },
      route!.onSuccess,
    )).toBe(true)
  })

  it('prefers the branch that costs nothing in an any-chain', () => {
    expect(minimalSatisfyingAtoms({
      any: [{ flag: 'a', eq: true }, { flag: 'b', eq: false }],
    })).toEqual([])
  })

  it('an objective satisfied by absence alone still gets its terminal scene', () => {
    const route = buildGuaranteedRoute({
      objectiveId: 'o', title: 'Do not raise the alarm',
      completionPredicates: { flag: 'alarm_raised', eq: false },
    })
    expect(route).not.toBeNull()
    expect(route!.onSuccess).toEqual([])
  })
})

describe('the rescue scene never leaks DM-only text to the player (2026-07-28)', () => {
  // Audited live: every rescue node in three guides opened on "The way forward narrows to one
  // thing: <objective title>. <hidden_description>" - authoring metadata and all - with stakes cut
  // off mid-word at 200 chars. This is the same class the seed was fixed for on 2026-07-26, when
  // `guidance` was moved into params; its neighbour was left doing the identical thing.
  const DM_ONLY =
    'The party must reach the wreck at low tide. Scenes 1 and 2 ground this, and node#8 resolves ' +
    'it via ing#3. This is the chapter climax, grounding Scene 7 and 8 toward the promised endings.'
  const input = {
    objectiveId: 'obj-rescue',
    title: 'Relight the Greywater lantern',
    hiddenDescription: DM_ONLY,
    completionPredicates: { all: [{ flag: 'lantern_relit', eq: true }] },
  }

  it('keeps the DM intent out of the stakes', () => {
    const route = buildGuaranteedRoute(input)!
    expect(route.stakes).not.toContain('Scene')
    expect(route.stakes).not.toContain('node#')
    expect(route.stakes).not.toContain('ing#')
    expect(DM_ONLY).not.toContain(route.stakes)
    expect(route.stakes).toContain(input.title)
  })

  it('never truncates the stakes mid-word', () => {
    const route = buildGuaranteedRoute({ ...input, hiddenDescription: 'x'.repeat(400) })!
    expect(route.stakes.endsWith('x')).toBe(false)
    expect(route.stakes).toBe(`Whether the party achieves: ${input.title}`)
  })

  it('the rescue NODE opens on fiction, carrying no authoring metadata', () => {
    const node = buildRescueNode('obj-rescue', buildGuaranteedRoute(input)!)
    for (const marker of ['Scene', 'node#', 'ing#', 'grounding', 'The way forward narrows']) {
      expect(node.narrationSeed).not.toContain(marker)
    }
    expect(node.narrationSeed).not.toContain(DM_ONLY)
    // The designer instruction stays in params, where the 2026-07-26 fix put it.
    expect(node.narrationSeed).not.toContain('Shape:')
    expect(node.encounter.params).toHaveProperty('guidance')
  })
})
