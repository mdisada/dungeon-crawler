import { describe, expect, it } from 'vitest'

import { proveGraph, proveObjective } from './prove'
import type { NavNode } from '../story/navigate'

function node(over: Partial<NavNode> & { key: string }): NavNode {
  return {
    id: over.key, objectiveId: 'o1', index: 0, role: 'route',
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    ...over,
  }
}

/** The shape stage 5 produces: fail route 0 -> route 1, fail the last route -> rescue. */
const healthy: NavNode[] = [
  node({ key: 'n0', index: 0, transitions: [
    { on: 'full', toNodeKey: null, arrivalContext: '' },
    { on: 'failed', toNodeKey: 'n1', arrivalContext: 'driven back' },
  ] }),
  node({ key: 'n1', index: 1, transitions: [
    { on: 'full', toNodeKey: null, arrivalContext: '' },
    { on: 'failed', toNodeKey: 'r0', arrivalContext: 'forced to the last way in' },
  ] }),
  node({ key: 'r0', index: 0, role: 'rescue' }),
]

const prove = (nodes: NavNode[]) =>
  proveObjective({ objectiveId: 'o1', title: 'Open the vault', nodes })

describe('a healthy graph', () => {
  it('proves clean', () => {
    expect(prove(healthy)).toEqual([])
  })

  it('reaches every authored node', () => {
    expect(prove(healthy).filter((f) => f.code === 'node_unreachable')).toEqual([])
  })

  it('is a no-op for an objective with no authored nodes (legacy)', () => {
    expect(prove([])).toEqual([])
  })
})

describe('the termination guarantee', () => {
  // The property the whole spine rests on: navigation answers `open` or `resolve` and never a
  // third thing, so no sequence of outcomes can leave the party in an objective with nothing to
  // play. These are the regression tests for that guarantee, not for any particular graph.

  it('never hangs on the authored shape', () => {
    expect(prove(healthy).some((f) => f.code === 'objective_can_hang')).toBe(false)
  })

  it('never hangs when the party loses every single scene', () => {
    // A ladder with no rescue at all - failure runs out of authored content immediately.
    const noRescue: NavNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
      ] }),
    ]
    expect(prove(noRescue).some((f) => f.code === 'objective_can_hang')).toBe(false)
  })

  it('never hangs on a graph whose failure edges all dangle', () => {
    // Legacy stored rows carry `failed -> null` dead ends. The navigator falls through them; the
    // walk confirms nothing strands.
    const dangling: NavNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: null, arrivalContext: '' },
      ] }),
      node({ key: 'n1', index: 1, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: null, arrivalContext: '' },
      ] }),
      node({ key: 'r0', index: 0, role: 'rescue' }),
    ]
    const findings = prove(dangling)
    expect(findings.some((f) => f.code === 'objective_can_hang')).toBe(false)
    expect(findings.some((f) => f.code === 'objective_never_completable')).toBe(false)
  })
})

describe('an objective that can only be lost', () => {
  it('flags a ladder where no scene ever resolves the objective', () => {
    // Every `full` edge routes onward instead of finishing. The party can win every scene and
    // still never close the thread - the one shape that survives a structural lint.
    const endless: NavNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: 'n1', arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1, transitions: [
        { on: 'full', toNodeKey: 'n0', arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n0', arrivalContext: 'x' },
      ] }),
    ]
    const findings = prove(endless)
    expect(findings.some((f) => f.code === 'objective_never_completable')).toBe(true)
    expect(findings.find((f) => f.code === 'objective_never_completable')!.message)
      .toContain('never won')
  })

  it('passes as soon as one scene resolves it', () => {
    const fixed: NavNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: 'n1', arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1 }),
    ]
    expect(prove(fixed).some((f) => f.code === 'objective_never_completable')).toBe(false)
  })

  it('counts a win through the rescue as winnable', () => {
    const rescueOnly: NavNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: 'r0', arrivalContext: '' },
        { on: 'failed', toNodeKey: 'r0', arrivalContext: 'x' },
      ] }),
      node({ key: 'r0', index: 0, role: 'rescue' }),
    ]
    expect(prove(rescueOnly).some((f) => f.code === 'objective_never_completable')).toBe(false)
  })
})

describe('unreachable content', () => {
  it('does not flag a node the fall-through can still pick up', () => {
    // n2 is routed to by nothing, but the navigator's "next unplayed route" fall-through reaches
    // it once the others are spent. Authored content the party CAN see is not orphaned.
    const orphan: NavNode[] = [...healthy, node({ key: 'n2', index: 9 })]
    expect(prove(orphan).some((f) => f.code === 'node_unreachable' && f.message.includes('n2'))).toBe(false)
  })

  it('flags a node belonging to a graph nothing can reach', () => {
    // A second rescue: `nextNode` only ever looks up ONE rescue node, so the extra is dead weight.
    const twoRescues: NavNode[] = [...healthy, node({ key: 'r1', index: 1, role: 'rescue' })]
    expect(prove(twoRescues).some((f) => f.code === 'node_unreachable' && f.message.includes('r1'))).toBe(true)
  })
})

describe('proveGraph', () => {
  it('proves each objective against its own nodes', () => {
    const findings = proveGraph({
      objectives: [
        { id: 'o1', title: 'Open the vault' },
        { id: 'o2', title: 'Escape' },
      ],
      nodes: [
        ...healthy,
        node({ key: 'o2n0', objectiveId: 'o2', index: 0, transitions: [
          { on: 'full', toNodeKey: 'o2n1', arrivalContext: '' },
          { on: 'failed', toNodeKey: 'o2n1', arrivalContext: 'x' },
        ] }),
        node({ key: 'o2n1', objectiveId: 'o2', index: 1, transitions: [
          { on: 'full', toNodeKey: 'o2n0', arrivalContext: '' },
          { on: 'failed', toNodeKey: 'o2n0', arrivalContext: 'x' },
        ] }),
      ],
    })
    expect(findings.some((f) => f.objectiveId === 'o1')).toBe(false)
    expect(findings.some((f) => f.objectiveId === 'o2' && f.code === 'objective_never_completable')).toBe(true)
  })

  it('scales to a full adventure without blowing up', () => {
    const objectives = Array.from({ length: 4 }, (_, i) => ({ id: `obj${i}`, title: `Objective ${i}` }))
    const nodes = objectives.flatMap((o) =>
      healthy.map((n) => ({ ...n, objectiveId: o.id, key: `${o.id}-${n.key}`, id: `${o.id}-${n.key}`,
        transitions: n.transitions.map((t) => ({
          ...t, toNodeKey: t.toNodeKey ? `${o.id}-${t.toNodeKey}` : null,
        })) })))
    expect(proveGraph({ objectives, nodes })).toEqual([])
  })
})
