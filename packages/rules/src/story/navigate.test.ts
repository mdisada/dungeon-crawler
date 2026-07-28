import { describe, expect, it } from 'vitest'

import { hasPlayableNode, nextNode, nodeBeatId } from './navigate'
import type { NavNode } from './navigate'
import { spineLoopId } from './loops'

function node(over: Partial<NavNode> & { key: string }): NavNode {
  return {
    id: over.key, objectiveId: 'o1', index: 0, role: 'route',
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    ...over,
  }
}

const graph: NavNode[] = [
  node({
    key: 'n0', index: 0,
    transitions: [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: 'n1', arrivalContext: 'Rebuffed, they circle to the cellar.' },
    ],
  }),
  node({ key: 'n1', index: 1 }),
  node({ key: 'r0', index: 0, role: 'rescue' }),
]

describe('nextNode', () => {
  it('opens the first route node when nothing has resolved', () => {
    const result = nextNode({ nodes: graph, fromKey: null, tier: null, usedKeys: [] })
    expect(result).toMatchObject({ action: 'open', reason: 'first' })
    if (result.action !== 'open') return
    expect(result.node.key).toBe('n0')
  })

  it('follows the authored failed edge, carrying its arrival context', () => {
    const result = nextNode({ nodes: graph, fromKey: 'n0', tier: 'failed', usedKeys: ['n0'] })
    expect(result).toMatchObject({ action: 'open', reason: 'transition' })
    if (result.action !== 'open') return
    expect(result.node.key).toBe('n1')
    expect(result.arrivalContext).toContain('cellar')
  })

  it('treats a null target on the SUCCESS tier as the objective resolving here', () => {
    const result = nextNode({ nodes: graph, fromKey: 'n0', tier: 'full', usedKeys: ['n0'] })
    expect(result).toEqual({ action: 'resolve', outcome: 'completed', reason: 'objective_done' })
  })

  it('director replan takes a different unused route', () => {
    const result = nextNode({ nodes: graph, fromKey: null, tier: null, usedKeys: ['n0'], rung: 'replan_beat' })
    expect(result).toMatchObject({ action: 'open', reason: 'alternate' })
    if (result.action !== 'open') return
    expect(result.node.key).toBe('n1')
  })

  it('director replan falls back to the rescue once routes are spent', () => {
    const result = nextNode({ nodes: graph, fromKey: null, tier: null, usedKeys: ['n0', 'n1'], rung: 'replan_beat' })
    expect(result).toMatchObject({ action: 'open', reason: 'rescue' })
    if (result.action !== 'open') return
    expect(result.node.key).toBe('r0')
  })

  it('director rescue goes straight to the rescue node', () => {
    const result = nextNode({ nodes: graph, fromKey: null, tier: null, usedKeys: [], rung: 'guaranteed_route' })
    expect(result).toMatchObject({ action: 'open', reason: 'rescue' })
  })

  it('a tier with no authored edge falls through to an unused route, never strands', () => {
    // n1 authors only a `full` edge, so resolving it as failed has nothing to follow.
    const result = nextNode({ nodes: graph, fromKey: 'n1', tier: 'failed', usedKeys: ['n1'] })
    expect(result).toMatchObject({ action: 'open', reason: 'alternate' })
    if (result.action !== 'open') return
    expect(result.node.key).toBe('n0')
  })

  it('retires the objective when every node has played', () => {
    const result = nextNode({ nodes: graph, fromKey: null, tier: null, usedKeys: ['n0', 'n1', 'r0'] })
    expect(result).toEqual({ action: 'resolve', outcome: 'failed', reason: 'exhausted' })
  })

  it('is deterministic', () => {
    const input = { nodes: graph, fromKey: null, tier: null, usedKeys: [] as string[] }
    expect(nextNode(input)).toEqual(nextNode(input))
  })
})

describe('hasPlayableNode', () => {
  it('is false only when everything has been played', () => {
    expect(hasPlayableNode(graph, ['n0'])).toBe(true)
    expect(hasPlayableNode(graph, ['n0', 'n1', 'r0'])).toBe(false)
  })
})

describe('null targets on failure tiers (2026-07-27 regression)', () => {
  // The live dead end: stage 5 authored `failed -> null` and `partial -> null`. Read as "the
  // objective resolved here", a failed scene opened nothing and credited nothing, and the party
  // stood in a finished room with the objective still open. Three of five live resolutions were
  // failed/partial, all awarded zero milestones, and one objective re-arrived here three times.
  //
  // No test in this file previously exercised a null target on anything but `full` - the suite
  // asserted the dead end was correct behaviour, which is why 762 green tests said nothing.
  const deadEnd: NavNode[] = [
    node({ key: 'n0', index: 0, transitions: [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: null, arrivalContext: '' },
    ] }),
    node({ key: 'n1', index: 1 }),
    node({ key: 'r0', index: 0, role: 'rescue' }),
  ]

  it('does NOT stop the objective on a failed tier pointing nowhere', () => {
    const r = nextNode({ nodes: deadEnd, fromKey: 'n0', tier: 'failed', usedKeys: ['n0'] })
    expect(r).toMatchObject({ action: 'open', reason: 'alternate' })
    if (r.action !== 'open') return
    expect(r.node.key).toBe('n1')
  })

  it('reaches the rescue rather than stopping when routes are spent', () => {
    const r = nextNode({ nodes: deadEnd, fromKey: 'n0', tier: 'failed', usedKeys: ['n0', 'n1'] })
    expect(r).toMatchObject({ action: 'open', reason: 'rescue' })
  })

  it('retires the objective the HARD way once a failing party has played everything', () => {
    const r = nextNode({ nodes: deadEnd, fromKey: 'n0', tier: 'failed', usedKeys: ['n0', 'n1', 'r0'] })
    expect(r).toEqual({ action: 'resolve', outcome: 'failed', reason: 'exhausted' })
  })

  it('still resolves the objective cleanly when the party actually succeeded', () => {
    expect(nextNode({ nodes: deadEnd, fromKey: 'n0', tier: 'full', usedKeys: ['n0'] }))
      .toEqual({ action: 'resolve', outcome: 'completed', reason: 'objective_done' })
  })

  it('never resolves a failure tier as COMPLETED, whatever has been played', () => {
    for (const used of [[], ['n0'], ['n0', 'n1'], ['n0', 'n1', 'r0']]) {
      const r = nextNode({ nodes: deadEnd, fromKey: 'n0', tier: 'failed', usedKeys: used })
      if (r.action === 'resolve') expect(r.outcome).toBe('failed')
    }
  })
})

describe('the termination guarantee (2026-07-27)', () => {
  // An objective must never be left with nothing to play. Every branch of nextNode returns either
  // a scene or a resolution, so a party that fails everything is handed the failure ending of the
  // thread and the story moves on - the Adventurers League failure box, not a stall.

  it('answers open or resolve for every reachable input, never a third thing', () => {
    const nodes: NavNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1 }),
      node({ key: 'r0', index: 0, role: 'rescue' }),
    ]
    const rungs = [null, 'replan_beat', 'guaranteed_route'] as const
    for (const used of [[], ['n0'], ['n0', 'n1'], ['n0', 'n1', 'r0']]) {
      for (const from of [null, 'n0', 'n1', 'r0']) {
        for (const tier of ['full', 'failed'] as const) {
          for (const rung of rungs) {
            const r = nextNode({ nodes, fromKey: from, tier: from ? tier : null, usedKeys: used, rung })
            expect(['open', 'resolve']).toContain(r.action)
          }
        }
      }
    }
  })

  it('resolves rather than replaying a rescue the party already lost', () => {
    const nodes: NavNode[] = [
      node({ key: 'n0', index: 0 }),
      node({ key: 'r0', index: 0, role: 'rescue' }),
    ]
    expect(nextNode({ nodes, fromKey: 'r0', tier: 'failed', usedKeys: ['n0', 'r0'], rung: 'guaranteed_route' }))
      .toEqual({ action: 'resolve', outcome: 'failed', reason: 'exhausted' })
  })

  it('resolves an objective with no authored nodes left rather than stranding it', () => {
    expect(nextNode({ nodes: [], fromKey: null, tier: null, usedKeys: [] }))
      .toEqual({ action: 'resolve', outcome: 'failed', reason: 'exhausted' })
  })

  it('reaches an unplayed rescue before resolving, with nothing yet resolved', () => {
    // Every route instantiated but no outcome recorded for this objective yet - the "nothing
    // resolved" branch. It returned `exhausted` here for as long as `exhausted` opened nothing,
    // and the moment exhaustion started RETIRING the objective that became a way to throw away
    // the ladder's terminal scene while it sat unplayed.
    const nodes: NavNode[] = [
      node({ key: 'n0', index: 0 }),
      node({ key: 'n1', index: 1 }),
      node({ key: 'r0', index: 0, role: 'rescue' }),
    ]
    const r = nextNode({ nodes, fromKey: null, tier: null, usedKeys: ['n0', 'n1'] })
    expect(r).toMatchObject({ action: 'open', reason: 'rescue' })
    if (r.action !== 'open') return
    expect(r.node.key).toBe('r0')
  })
})

describe('failure loops (2026-07-26 regression)', () => {
  // The live cage: n0 fails -> n1, n1 fails -> n0. Followed blindly, one node resolved 14 times
  // and a single objective took 75 turns.
  const cycle: NavNode[] = [
    node({ key: 'n0', index: 0, transitions: [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: 'n1', arrivalContext: 'driven back toward the other way' },
    ] }),
    node({ key: 'n1', index: 1, transitions: [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: 'n0', arrivalContext: 'forced back the way they came' },
    ] }),
    node({ key: 'r0', index: 0, role: 'rescue' }),
  ]

  it('follows the failure edge the FIRST time', () => {
    const r = nextNode({ nodes: cycle, fromKey: 'n0', tier: 'failed', usedKeys: ['n0'] })
    expect(r).toMatchObject({ action: 'open', reason: 'transition' })
    if (r.action !== 'open') return
    expect(r.node.key).toBe('n1')
  })

  it('does NOT send them back to a scene already played', () => {
    const r = nextNode({ nodes: cycle, fromKey: 'n1', tier: 'failed', usedKeys: ['n0', 'n1'] })
    if (r.action === 'open') expect(r.node.key).not.toBe('n0')
  })

  it('falls through to the rescue once every route has been played', () => {
    const r = nextNode({ nodes: cycle, fromKey: 'n1', tier: 'failed', usedKeys: ['n0', 'n1'] })
    expect(r).toMatchObject({ action: 'open', reason: 'rescue' })
  })

  it('retires the objective rather than looping when even the rescue is spent', () => {
    const r = nextNode({ nodes: cycle, fromKey: 'n1', tier: 'failed', usedKeys: ['n0', 'n1', 'r0'] })
    expect(r).toEqual({ action: 'resolve', outcome: 'failed', reason: 'exhausted' })
  })

  it('a full success still resolves the objective, not a re-route', () => {
    expect(nextNode({ nodes: cycle, fromKey: 'n0', tier: 'full', usedKeys: ['n0'] }))
      .toEqual({ action: 'resolve', outcome: 'completed', reason: 'objective_done' })
  })
})

describe('one beat per authored node (2026-07-27)', () => {
  it('derives a stable, well-formed id from the node', () => {
    const node = '58d06487-e9af-4849-ae88-04bdc2ba94bd'
    const id = nodeBeatId(node)
    expect(id).toBe(nodeBeatId(node))
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-b[0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(id).not.toBe(node)
  })

  it('distinct nodes never share a beat id', () => {
    expect(nodeBeatId('58d06487-e9af-4849-ae88-04bdc2ba94bd'))
      .not.toBe(nodeBeatId('9ba17545-4c2c-4874-88f2-207e0d0a91ec'))
  })

  it('can never collide with the spine loop derived from the same uuid', () => {
    const shared = '58d06487-e9af-4849-ae88-04bdc2ba94bd'
    expect(nodeBeatId(shared)).not.toBe(spineLoopId(shared))
  })

  it('leaves a non-uuid untouched rather than emitting a malformed one', () => {
    expect(nodeBeatId('legacy-beat')).toBe('legacy-beat')
  })
})
