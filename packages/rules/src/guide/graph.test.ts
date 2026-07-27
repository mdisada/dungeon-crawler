import { describe, expect, it } from 'vitest'

import { hasBlockingErrors, lintStoryGraph, routeCount } from './graph'
import type { GraphNode, StoryGraph } from './graph'

/** A minimal but healthy guide: 2 objectives, 2 routes each, a living NPC, endings both ways. */
function healthy(): StoryGraph {
  return {
    chapters: [{ id: 'c1', index: 0, title: 'The Dark Lantern' }],
    objectives: [
      {
        id: 'o1', chapterId: 'c1', index: 0, title: 'Relight the lantern',
        completionPredicates: { all: [{ flag: 'lantern_relit', eq: true }] },
        guaranteedRouteAtoms: ['lantern_relit'],
      },
      {
        id: 'o2', chapterId: 'c1', index: 1, title: 'Confront the wreckers',
        completionPredicates: { any: [{ flag: 'wreckers_routed', eq: true }] },
        guaranteedRouteAtoms: ['wreckers_routed'],
      },
    ],
    npcs: [
      { id: 'n1', name: 'Sereth Vane', chapterId: 'c1', initialState: 'alive' },
      { id: 'n2', name: 'Keeper Elphin', chapterId: 'c1', initialState: 'absent' },
    ],
    encounters: [
      { id: 'e1', chapterId: 'c1', type: 'skill_challenge', outcomeAtoms: ['lantern_relit'] },
      { id: 'e2', chapterId: 'c1', type: 'combat', outcomeAtoms: ['wreckers_routed'] },
    ],
    ingredients: [
      { id: 'i1', chapterId: 'c1', awardsAtoms: ['lantern_relit'] },
      { id: 'i2', chapterId: 'c1', awardsAtoms: ['wreckers_routed'] },
    ],
    endings: [
      { id: 'end1', title: 'The Lantern Burns Again', objectiveSignals: [{ objectiveId: 'o1', outcome: 'completed', weight: 3 }] },
      { id: 'end2', title: 'Greywater Goes Dark', objectiveSignals: [{ objectiveId: 'o1', outcome: 'failed', weight: 3 }] },
    ],
  }
}

describe('a healthy guide passes clean', () => {
  it('produces no findings at all', () => {
    expect(lintStoryGraph(healthy())).toEqual([])
    expect(hasBlockingErrors(lintStoryGraph(healthy()))).toBe(false)
  })
})

describe('routeCount', () => {
  it('counts every route that covers the full atom set', () => {
    expect(routeCount(healthy().objectives[0], healthy())).toBe(2)
  })
  it('a partial cover of an all-chain is not a route', () => {
    const graph = healthy()
    graph.objectives[0].completionPredicates = {
      all: [{ flag: 'lantern_relit', eq: true }, { flag: 'keeper_freed', eq: true }],
    }
    // Neither the encounter nor the ingredient awards keeper_freed.
    expect(routeCount(graph.objectives[0], graph)).toBe(0)
  })
  it('matches canonically, so punctuation variants still count', () => {
    const graph = healthy()
    graph.encounters[0].outcomeAtoms = ['Lantern Relit']
    expect(routeCount(graph.objectives[0], graph)).toBeGreaterThan(0)
  })
})

describe('errors — the adventure can lock', () => {
  it('an objective nothing awards, with no rescue, is a hard error', () => {
    const graph = healthy()
    graph.encounters = []
    graph.ingredients = []
    graph.objectives[0].guaranteedRouteAtoms = []
    graph.objectives[1].guaranteedRouteAtoms = []
    const findings = lintStoryGraph(graph)
    expect(findings.filter((f) => f.code === 'objective_unreachable')).toHaveLength(2)
    expect(hasBlockingErrors(findings)).toBe(true)
  })

  it('a guaranteed route keeps it out of ERROR territory (it is still finishable)', () => {
    const graph = healthy()
    graph.encounters = []
    graph.ingredients = []
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'objective_unreachable')).toBe(false)
    expect(findings.some((f) => f.code === 'objective_thin_routes')).toBe(true)
    expect(hasBlockingErrors(findings)).toBe(false)
  })

  it('an objective with no claimable atom can never complete', () => {
    const graph = healthy()
    graph.objectives[0].completionPredicates = { flag: 'never_set', eq: false }
    expect(lintStoryGraph(graph).some((f) => f.code === 'objective_no_claimable_atom')).toBe(true)
  })

  it('THE Sunken Chapel failure: a chapter with nobody alive', () => {
    const graph = healthy()
    graph.npcs = [
      { id: 'n1', name: 'Lost Expedition', chapterId: 'c1', initialState: 'dead' },
      { id: 'n2', name: 'The Murkheart', chapterId: 'c1', initialState: 'absent' },
    ]
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'chapter_no_living_npc')).toBe(true)
    expect(hasBlockingErrors(findings)).toBe(true)
  })

  it('a global living NPC satisfies every chapter', () => {
    const graph = healthy()
    graph.npcs = [
      { id: 'n1', name: 'Lost Expedition', chapterId: 'c1', initialState: 'dead' },
      { id: 'n3', name: 'A wandering broker', chapterId: null, initialState: 'alive' },
    ]
    expect(lintStoryGraph(graph).some((f) => f.code === 'chapter_no_living_npc')).toBe(false)
  })

  it('an ending keyed on a nonexistent objective is unreachable', () => {
    const graph = healthy()
    graph.endings[0].objectiveSignals = [{ objectiveId: 'ghost', outcome: 'completed', weight: 3 }]
    expect(lintStoryGraph(graph).some((f) => f.code === 'ending_unreachable')).toBe(true)
  })
})

describe('warnings — the adventure is thin', () => {
  it('one authored route warns (Three-Clue Rule)', () => {
    const graph = healthy()
    graph.ingredients = []
    const findings = lintStoryGraph(graph)
    expect(findings.filter((f) => f.code === 'objective_thin_routes')).toHaveLength(2)
    expect(hasBlockingErrors(findings)).toBe(false)
  })

  it('warns when no ending can absorb a failure-heavy run', () => {
    const graph = healthy()
    graph.endings = [
      { id: 'end1', title: 'All Is Well', objectiveSignals: [{ objectiveId: 'o1', outcome: 'completed', weight: 3 }] },
    ]
    expect(lintStoryGraph(graph).some((f) => f.code === 'no_failure_ending')).toBe(true)
  })

  it('flags awards that match no objective', () => {
    const graph = healthy()
    graph.ingredients.push({ id: 'i9', chapterId: 'c1', awardsAtoms: ['a_thread_nobody_reads'] })
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'orphan_award_atoms')).toBe(true)
    expect(hasBlockingErrors(findings)).toBe(false)
  })

  it('a dial-only ending is not treated as unreachable', () => {
    const graph = healthy()
    graph.endings.push({ id: 'end3', title: 'A Fragile Truce', objectiveSignals: [] })
    expect(lintStoryGraph(graph).some((f) => f.code === 'ending_unreachable')).toBe(false)
  })
})

describe('entities that are not people (2026-07-23)', () => {
  it('warns when an ending needs rapport with someone never present', () => {
    // The live shape: an adventure whose endings all keyed on "The Blighted Heart = allied" -
    // a corrupting force authored as an NPC. Nothing in play gives a phenomenon feelings.
    const graph = healthy()
    graph.npcs.push({ id: 'force', name: 'The Blighted Heart', chapterId: 'c1', initialState: 'absent' })
    graph.endings.push({
      id: 'end3',
      title: 'Embrace of Corruption',
      objectiveSignals: [{ objectiveId: 'o1', outcome: 'completed', weight: 3 }],
      npcSignals: [{ npcId: 'force', state: 'allied', weight: 4 }],
    })
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'ending_needs_absent_npc_rapport')).toBe(true)
    // A warning, not an error - the ending can still land on its objective signal.
    expect(hasBlockingErrors(findings)).toBe(false)
  })

  it('does not warn about rapport with a present person', () => {
    const graph = healthy()
    graph.endings.push({
      id: 'end3',
      title: 'The Harbormistress Stands With Us',
      objectiveSignals: [{ objectiveId: 'o1', outcome: 'completed', weight: 3 }],
      npcSignals: [{ npcId: 'n1', state: 'allied', weight: 4 }],
    })
    expect(lintStoryGraph(graph).some((f) => f.code === 'ending_needs_absent_npc_rapport')).toBe(false)
  })

  it('ignores negative-weight signals (counter-signals need not be reachable)', () => {
    const graph = healthy()
    graph.npcs.push({ id: 'force', name: 'The Blight', chapterId: 'c1', initialState: 'absent' })
    graph.endings.push({
      id: 'end3', title: 'Held Back',
      objectiveSignals: [{ objectiveId: 'o1', outcome: 'completed', weight: 3 }],
      npcSignals: [{ npcId: 'force', state: 'allied', weight: -4 }],
    })
    expect(lintStoryGraph(graph).some((f) => f.code === 'ending_needs_absent_npc_rapport')).toBe(false)
  })
})

/** A healthy authored graph: each objective gets two route nodes, one combat node, registered
 *  atoms, a living NPC for the social node. */
function withNodes(): StoryGraph {
  const graph = healthy()
  const mk = (over: Partial<GraphNode>): GraphNode => ({
    id: over.key ?? 'x', key: 'x', objectiveId: 'o1', kind: 'skill_challenge', role: 'route',
    // Every route node banks a setback: `failure_writes_nothing` makes a free loss an error.
    onSuccess: [], onPartial: [], onFailure: ['ground_lost'], npcIds: [],
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    ...over,
  })
  graph.nodes = [
    mk({ key: 'o1n0', id: 'o1n0', objectiveId: 'o1', kind: 'social', npcIds: ['n1'], onSuccess: ['lantern_relit'] }),
    mk({ key: 'o1n1', id: 'o1n1', objectiveId: 'o1', onSuccess: ['lantern_relit'] }),
    mk({ key: 'o2n0', id: 'o2n0', objectiveId: 'o2', kind: 'combat', onSuccess: ['wreckers_routed'] }),
    mk({ key: 'o2n1', id: 'o2n1', objectiveId: 'o2', onSuccess: ['wreckers_routed'] }),
  ]
  graph.registryAtoms = ['lantern_relit', 'wreckers_routed', 'ground_lost']
  graph.minPlayers = 1
  return graph
}

describe('authored node graph (2026-07-26)', () => {
  it('a healthy node graph passes clean', () => {
    expect(lintStoryGraph(withNodes())).toEqual([])
  })

  it('a dangling transition target is a hard error', () => {
    const graph = withNodes()
    graph.nodes![0].transitions = [{ on: 'full', toNodeKey: 'ghost', arrivalContext: '' }]
    expect(lintStoryGraph(graph).some((f) => f.code === 'node_dangling_transition')).toBe(true)
  })

  it('a failed edge with no arrival context is a hard error', () => {
    const graph = withNodes()
    graph.nodes![0].transitions = [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: 'o1n1', arrivalContext: '' },
    ]
    expect(lintStoryGraph(graph).some((f) => f.code === 'transition_missing_arrival_context')).toBe(true)
  })

  it('a failure edge pointing nowhere is a hard error', () => {
    // Shipped live 2026-07-26: stage 5 authored `failed -> null`, the gate skipped every null
    // target, and the runtime read it as "the objective resolved here" - a failed scene that
    // opened nothing and credited nothing.
    const graph = withNodes()
    graph.nodes![0].transitions = [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: null, arrivalContext: 'driven back' },
    ]
    expect(lintStoryGraph(graph).some((f) => f.code === 'failure_transition_dead_end')).toBe(true)
  })

  it('a null target on the success tier stays legal', () => {
    const graph = withNodes()
    graph.nodes![0].transitions = [{ on: 'full', toNodeKey: null, arrivalContext: '' }]
    expect(lintStoryGraph(graph).some((f) => f.code === 'failure_transition_dead_end')).toBe(false)
  })

  it('a route node that awards nothing on failure is a hard error', () => {
    // Replaces `failure_loop_no_escalation`, which only fired on a failed edge pointing at its own
    // node - a shape stage 5 can no longer produce. The general case went unchecked: live, three
    // of five resolutions came in failed or partial and every one awarded zero atoms.
    const graph = withNodes()
    graph.nodes![1].onFailure = []
    expect(lintStoryGraph(graph).some((f) => f.code === 'failure_writes_nothing')).toBe(true)
  })

  it('a rescue node may award nothing on failure - it exists to be won', () => {
    const graph = withNodes()
    graph.nodes!.push({
      ...graph.nodes![1], id: 'o1r0', key: 'o1r0', role: 'rescue', onFailure: [],
    })
    const rescueFindings = lintStoryGraph(graph)
      .filter((f) => f.code === 'failure_writes_nothing' && f.message.includes('o1r0'))
    expect(rescueFindings).toEqual([])
  })

  it('an outcome atom off the registry is a hard error', () => {
    const graph = withNodes()
    graph.nodes![1].onSuccess = ['lantern_relit', 'smuggled_in_a_stray']
    expect(lintStoryGraph(graph).some((f) => f.code === 'node_outcome_off_registry')).toBe(true)
  })

  it('a social node staging nobody alive can never open', () => {
    const graph = withNodes()
    graph.nodes![0].npcIds = ['n2'] // n2 is absent
    expect(lintStoryGraph(graph).some((f) => f.code === 'node_unstageable_npc')).toBe(true)
  })

  it('a node needing more players than min_players is unplayable', () => {
    const graph = withNodes()
    graph.nodes![1].minParticipants = 2
    graph.minPlayers = 1
    expect(lintStoryGraph(graph).some((f) => f.code === 'min_players_unplayable')).toBe(true)
  })

  it('too few route nodes is an error, not a warning', () => {
    const graph = withNodes()
    graph.nodes = graph.nodes!.filter((n) => n.key !== 'o1n1') // o1 now has one route node
    expect(lintStoryGraph(graph).some((f) => f.code === 'objective_missing_route_nodes')).toBe(true)
  })

  it('a thin finale is flagged as climax_underfunded', () => {
    const graph = withNodes()
    graph.nodes = graph.nodes!.filter((n) => n.key !== 'o2n1') // o2 (last objective) now thin
    expect(lintStoryGraph(graph).some((f) => f.code === 'climax_underfunded')).toBe(true)
  })

  it('warns when no combat is authored (floor)', () => {
    const graph = withNodes()
    graph.nodes![2].kind = 'skill_challenge'
    expect(lintStoryGraph(graph).some((f) => f.code === 'combat_floor_unmet')).toBe(true)
  })

  it('a setback atom is not an orphan award', () => {
    // Regression (2026-07-26): partial/failure atoms are authored CONSEQUENCES, not routes.
    // Counting them made every authored graph report a fistful of orphan awards.
    const graph = withNodes()
    graph.nodes![0].onFailure = ['guards_alerted']
    graph.registryAtoms = [...graph.registryAtoms!, 'guards_alerted']
    expect(lintStoryGraph(graph).some((f) => f.code === 'orphan_award_atoms')).toBe(false)
  })

  it('still flags a SUCCESS atom no objective reads', () => {
    const graph = withNodes()
    graph.nodes![0].onSuccess = ['lantern_relit', 'a_thread_nobody_reads']
    graph.registryAtoms = [...graph.registryAtoms!, 'a_thread_nobody_reads']
    expect(lintStoryGraph(graph).some((f) => f.code === 'orphan_award_atoms')).toBe(true)
  })
})

describe('personal arcs stay reward-only (2026-07-26)', () => {
  it('a personal atom completing an objective is a hard error', () => {
    const graph = withNodes()
    graph.personalAtoms = ['lantern_relit']
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'personal_atom_in_structural_position')).toBe(true)
    expect(hasBlockingErrors(findings)).toBe(true)
  })

  it('a node crediting a personal atom is a hard error', () => {
    const graph = withNodes()
    graph.nodes![1].onFailure = ['private_grief_eased']
    graph.registryAtoms = [...graph.registryAtoms!, 'private_grief_eased']
    graph.personalAtoms = ['private_grief_eased']
    expect(lintStoryGraph(graph).some((f) => f.code === 'personal_atom_in_structural_position')).toBe(true)
  })

  it('a slot with no existing overlay scene can never surface', () => {
    const graph = withNodes()
    graph.personalSlots = [{ id: 'p1', key: 'the_bereaved', overlayNodeKeys: ['ghost'] }]
    expect(lintStoryGraph(graph).some((f) => f.code === 'personal_slot_unreachable_overlay')).toBe(true)
  })

  it('fewer slots than max_players warns but does not block', () => {
    const graph = withNodes()
    graph.personalSlots = [{ id: 'p1', key: 'a', overlayNodeKeys: ['o1n0'] }]
    graph.maxPlayers = 4
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'personal_slots_thin')).toBe(true)
    expect(hasBlockingErrors(findings)).toBe(false)
  })

  it('healthy personal content produces no findings', () => {
    const graph = withNodes()
    graph.personalAtoms = ['private_grief_eased']
    graph.personalSlots = [{ id: 'p1', key: 'a', overlayNodeKeys: ['o1n0'] }]
    graph.maxPlayers = 1
    expect(lintStoryGraph(graph)).toEqual([])
  })
})

describe('phantom completion (2026-07-23)', () => {
  it('an objective true against an empty world is a hard error', () => {
    // The evaluator now reads an unset flag as false so deadlines work; a predicate built only
    // from negative clauses therefore holds on turn zero. That is the "objective completed for
    // no reason" shape this whole overhaul started from.
    // A mixed any-chain is the dangerous shape: it HAS a claimable atom, so it clears the
    // no-claimable-atom guard, and then holds anyway because the negative branch is free.
    const graph = healthy()
    graph.objectives[0].completionPredicates = {
      any: [{ flag: 'alarm_raised', eq: false }, { flag: 'lantern_relit', eq: true }],
    }
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'objective_satisfied_at_start')).toBe(true)
    expect(hasBlockingErrors(findings)).toBe(true)
  })

  it('a purely negative predicate is still caught, by the no-claimable-atom guard', () => {
    const graph = healthy()
    graph.objectives[0].completionPredicates = { flag: 'alarm_raised', eq: false }
    expect(lintStoryGraph(graph).some((f) => f.code === 'objective_no_claimable_atom')).toBe(true)
  })

  it('a deadline clause paired with real work is fine', () => {
    const graph = healthy()
    graph.objectives[0].completionPredicates = {
      all: [{ flag: 'lantern_relit', eq: true }, { flag: 'eight_days_passed', eq: false }],
    }
    const findings = lintStoryGraph(graph)
    expect(findings.some((f) => f.code === 'objective_satisfied_at_start')).toBe(false)
  })
})
