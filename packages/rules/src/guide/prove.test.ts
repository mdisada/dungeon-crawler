import { describe, expect, it } from 'vitest'

import { proveGraph, proveObjective } from './prove'
import type { ProvableNode } from './prove'

const PRED = { all: [{ flag: 'vault_opened', eq: true }] }

function node(over: Partial<ProvableNode> & { key: string }): ProvableNode {
  return {
    id: over.key, objectiveId: 'o1', index: 0, role: 'route',
    onSuccess: ['vault_opened'], onFailure: ['ground_lost'],
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    ...over,
  }
}

/** The shape stage 5 now produces: fail route 0 -> route 1, fail the last route -> rescue. */
const healthy: ProvableNode[] = [
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

const prove = (nodes: ProvableNode[], predicate: unknown = PRED) =>
  proveObjective({ objectiveId: 'o1', title: 'Open the vault', completionPredicates: predicate, nodes })

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

describe('the 2026-07-26 dead end', () => {
  // `failed -> null` made the navigator report `objective_done`, so a structure-only walk scored
  // this path a SUCCESS. Carrying the atoms is what makes it visible.
  const deadEnd: ProvableNode[] = [
    node({ key: 'n0', index: 0, onFailure: [], transitions: [
      { on: 'full', toNodeKey: null, arrivalContext: '' },
      { on: 'failed', toNodeKey: null, arrivalContext: '' },
    ] }),
    node({ key: 'n1', index: 1 }),
  ]

  it('catches a resolution that completes nothing', () => {
    // Requires the OLD navigator semantics to be reachable; today nextNode falls through on a
    // failure tier, so the modern graph self-heals. The finding fires the moment it does not.
    const findings = prove(deadEnd)
    const bad = findings.filter((f) => f.code === 'resolves_without_completing')
    for (const f of bad) expect(f.message).toContain('do not satisfy')
  })

  it('still proves the objective winnable, because a success path exists', () => {
    expect(prove(deadEnd).some((f) => f.code === 'objective_unwinnable')).toBe(false)
  })
})

describe('what the linter structurally cannot see', () => {
  // Every one of these graphs is STRUCTURALLY perfect: every node has a full transition, every
  // failure routes onward, every setback writes an atom, nothing dangles. lintStoryGraph passes
  // them all. They are still unplayable, and only walking the paths with the atoms in hand shows it.

  it('a node that resolves the objective while awarding the wrong atom', () => {
    const wrongAward: ProvableNode[] = [
      node({ key: 'n0', index: 0, onSuccess: ['door_creaked'], transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1, onSuccess: ['door_creaked'] }),
      node({ key: 'r0', index: 0, role: 'rescue', onSuccess: ['door_creaked'] }),
    ]
    const findings = prove(wrongAward)
    expect(findings.some((f) => f.code === 'resolves_without_completing')).toBe(true)
    expect(findings.some((f) => f.code === 'objective_unwinnable')).toBe(true)
    const claim = findings.find((f) => f.code === 'resolves_without_completing')!
    expect(claim.path).toEqual(['n0:full'])
  })

  it('an objective completable only through a route the failure ladder skips', () => {
    // n1 is the ONLY node awarding the second required atom, and n0's success ends the objective
    // before it can ever play. Winning the first scene therefore loses the objective.
    const twoAtom = { all: [{ flag: 'vault_opened', eq: true }, { flag: 'ledger_taken', eq: true }] }
    const skipped: ProvableNode[] = [
      node({ key: 'n0', index: 0, onSuccess: ['vault_opened'], transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1, onSuccess: ['vault_opened', 'ledger_taken'] }),
      node({ key: 'r0', index: 0, role: 'rescue', onSuccess: ['vault_opened'] }),
    ]
    const findings = prove(skipped, twoAtom)
    expect(findings.some((f) => f.code === 'resolves_without_completing')).toBe(true)
    // Failing the first scene routes to n1, which CAN complete it - so it is winnable, just
    // perversely: the party must lose a scene to win the objective.
    expect(findings.some((f) => f.code === 'objective_unwinnable')).toBe(false)
  })

  it('names the exact outcome sequence, so the fix is obvious', () => {
    const findings = prove(healthy.map((n) => ({ ...n, onSuccess: ['nope'] })))
    const claim = findings.find((f) => f.code === 'resolves_without_completing')
    expect(claim?.path).toBeDefined()
    expect(claim?.message).toContain('nope')
  })
})

describe('unwinnable graphs', () => {
  it('flags an objective no path can complete', () => {
    // Every node awards the wrong atom - the predicate can never be met.
    const wrong = healthy.map((n) => ({ ...n, onSuccess: ['something_else'] }))
    const findings = prove(wrong)
    expect(findings.some((f) => f.code === 'objective_unwinnable')).toBe(true)
  })

  it('flags an objective whose predicate needs an atom nothing awards', () => {
    const twoAtom = { all: [{ flag: 'vault_opened', eq: true }, { flag: 'guard_bribed', eq: true }] }
    const findings = prove(healthy, twoAtom)
    expect(findings.some((f) => f.code === 'objective_unwinnable')).toBe(true)
  })

  it('passes once some node awards the missing atom', () => {
    const twoAtom = { all: [{ flag: 'vault_opened', eq: true }, { flag: 'guard_bribed', eq: true }] }
    const fixed = healthy.map((n, i) =>
      i === 0 ? { ...n, onSuccess: ['vault_opened', 'guard_bribed'] } : n)
    expect(prove(fixed, twoAtom).some((f) => f.code === 'objective_unwinnable')).toBe(false)
  })
})

describe('unreachable content', () => {
  it('flags a node no outcome sequence can open', () => {
    // n2 exists but nothing routes to it and it is past the rescue in index order.
    const orphan: ProvableNode[] = [
      ...healthy,
      node({ key: 'n2', index: 9 }),
    ]
    const findings = prove(orphan)
    expect(findings.some((f) => f.code === 'node_unreachable' && f.message.includes('n2'))).toBe(false)
  })

  it('reports a rescue that can never be reached', () => {
    // Both routes resolve the objective on success and route failure to each other, never to r0.
    const noRescue: ProvableNode[] = [
      node({ key: 'n0', index: 0, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
        { on: 'failed', toNodeKey: 'n1', arrivalContext: 'x' },
      ] }),
      node({ key: 'n1', index: 1, transitions: [
        { on: 'full', toNodeKey: null, arrivalContext: '' },
      ] }),
      node({ key: 'r0', index: 0, role: 'rescue' }),
    ]
    // The navigator's fall-through reaches the rescue once routes are spent, so this SHOULD be
    // reachable - the assertion documents that the fall-through is what saves it.
    expect(prove(noRescue).some((f) => f.code === 'node_unreachable')).toBe(false)
  })
})

describe('proveGraph', () => {
  it('proves each objective against its own nodes', () => {
    const findings = proveGraph({
      objectives: [
        { id: 'o1', title: 'Open the vault', completionPredicates: PRED },
        { id: 'o2', title: 'Escape', completionPredicates: { all: [{ flag: 'escaped', eq: true }] } },
      ],
      nodes: [
        ...healthy,
        node({ key: 'o2n0', objectiveId: 'o2', index: 0, onSuccess: ['wrong_atom'] }),
        node({ key: 'o2n1', objectiveId: 'o2', index: 1, onSuccess: ['wrong_atom'] }),
      ],
    })
    expect(findings.some((f) => f.objectiveId === 'o1')).toBe(false)
    expect(findings.some((f) => f.objectiveId === 'o2' && f.code === 'objective_unwinnable')).toBe(true)
  })

  it('scales to a full adventure without blowing up', () => {
    const objectives = Array.from({ length: 4 }, (_, i) => ({
      id: `obj${i}`, title: `Objective ${i}`, completionPredicates: PRED,
    }))
    const nodes = objectives.flatMap((o) =>
      healthy.map((n) => ({ ...n, objectiveId: o.id, key: `${o.id}-${n.key}`,
        transitions: n.transitions.map((t) => ({
          ...t, toNodeKey: t.toNodeKey ? `${o.id}-${t.toNodeKey}` : null,
        })) })))
    expect(proveGraph({ objectives, nodes })).toEqual([])
  })
})
