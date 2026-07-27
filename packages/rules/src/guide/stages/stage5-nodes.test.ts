import { describe, expect, it } from 'vitest'

import { buildRescueNode, objectiveKeyOf, parseStage5Nodes } from './stage5-nodes'
import type { Stage5NodesContext } from './stage5-nodes'
import { atomsSatisfy, buildGuaranteedRoute } from '../guaranteed-route'
import { validateNodeGraph } from '../nodes'

const ctx: Stage5NodesContext = {
  chapterNumber: 1,
  chapterTitle: 'The Drowned Ledger',
  objectives: [
    {
      id: 'o1',
      title: 'Recover the ledger',
      hiddenDescription: 'It is in the harbormaster\'s strongbox.',
      completionPredicates: { all: [{ flag: 'ledger_recovered', eq: true }] },
    },
  ],
  npcs: [{ key: 'npc:mara', name: 'Harbormaster Mara' }],
  partySkills: ['stealth', 'persuasion'],
}

function rawOutput(over?: unknown): string {
  const doc = over ?? {
    objectives: [
      {
        objective_number: 1,
        nodes: [
          {
            kind: 'social',
            narration_seed: 'Mara guards the strongbox behind the counter.',
            stakes: 'She can call the watch.',
            npc_keys: ['npc:mara'],
            affordances: [{ key: 'persuade', hint: 'talk her into opening it' }],
            local_atoms: [{ name: 'watch_alerted', kind: 'flag' }],
            on_partial: [],
            on_failure: ['watch_alerted'],
            transitions: [
              { on: 'full', to: 'done', arrival_context: '' },
              { on: 'failed', to: 1, arrival_context: 'Rebuffed, the party eyes the cellar hatch.' },
            ],
          },
          {
            kind: 'skill_challenge',
            narration_seed: 'The cellar hatch is barred but the timbers are rotten.',
            stakes: 'Noise brings Mara running.',
            affordances: [{ key: 'break_in', hint: 'force the hatch quietly' }],
            transitions: [{ on: 'full', to: 'done', arrival_context: '' }],
          },
        ],
      },
    ],
  }
  return JSON.stringify(doc)
}

describe('parseStage5Nodes', () => {
  it('parses two route nodes and DERIVES onSuccess from the objective predicate', () => {
    const result = parseStage5Nodes(rawOutput(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes).toHaveLength(2)
    for (const { node } of result.data.nodes) {
      expect(node.encounter.onSuccess).toEqual(['ledger_recovered'])
      expect(atomsSatisfy(ctx.objectives[0].completionPredicates, node.encounter.onSuccess)).toBe(true)
    }
    // The social node's failure writes its declared setback atom.
    expect(result.data.nodes[0].node.encounter.onFailure).toEqual(['watch_alerted'])
    expect(result.data.localAtoms.map((a) => a.name)).toContain('watch_alerted')
  })

  it('keys sibling transitions to real node keys', () => {
    const result = parseStage5Nodes(rawOutput(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const failed = result.data.nodes[0].node.transitions.find((t) => t.on === 'failed')
    expect(failed?.toNodeKey).toBe(`${objectiveKeyOf('o1')}#n1`)
    expect(validateNodeGraph(result.data.nodes.map((n) => n.node))).toEqual([])
  })

  it('forces a full-success transition to resolve the objective', () => {
    // Regression (2026-07-26): a route node's on_success IS the objective's minimal satisfying
    // set, so `full -> sibling` is dead - the objective completes and the sibling never plays.
    const doc = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: 'x.', affordances: [{ key: 'a', hint: 'go' }],
          transitions: [{ on: 'full', to: 1, arrival_context: 'onward' }] },
        { kind: 'skill_challenge', narration_seed: 'y.', affordances: [{ key: 'b', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
      ] }],
    }
    const result = parseStage5Nodes(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const full = result.data.nodes[0].node.transitions.find((t) => t.on === 'full')
    expect(full?.toNodeKey).toBeNull()
  })

  it('still lets a failed outcome lead onward', () => {
    const result = parseStage5Nodes(rawOutput(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes[0].node.transitions.find((t) => t.on === 'failed')?.toNodeKey)
      .toBe(`${objectiveKeyOf('o1')}#n1`)
  })

  describe('a setback may never resolve the objective (2026-07-27)', () => {
    // 68 `failed -> done` edges shipped across 11 of 11 guides, because the prompt permitted it
    // and the parser passed it through. At runtime that node opened nothing next and credited
    // nothing, stranding the party in a finished scene with the objective still open.
    const withFailedTo = (to: unknown) => ({
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: 'The counter.', stakes: 's',
          affordances: [{ key: 'a', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' },
            { on: 'failed', to, arrival_context: 'Rebuffed.' }] },
        { kind: 'skill_challenge', narration_seed: 'The hatch.', stakes: 's',
          affordances: [{ key: 'b', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' },
            { on: 'failed', to, arrival_context: 'Rebuffed.' }] },
      ] }],
    })
    const failedEdges = (doc: unknown) => {
      const result = parseStage5Nodes(rawOutput(doc), ctx)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      return result.data.nodes.map((n) => n.node.transitions.find((t) => t.on === 'failed'))
    }

    it('rewrites `failed -> done` into the next route, then the rescue', () => {
      const [first, last] = failedEdges(withFailedTo('done'))
      expect(first?.toNodeKey).toBe(`${objectiveKeyOf('o1')}#n1`)
      expect(last?.toNodeKey).toBe(`${objectiveKeyOf('o1')}#r0`)
    })

    it('rewrites a self-targeting setback rather than replaying the same scene', () => {
      const [first] = failedEdges(withFailedTo(0))
      expect(first?.toNodeKey).toBe(`${objectiveKeyOf('o1')}#n1`)
    })

    it('rewrites an out-of-range target', () => {
      const [first] = failedEdges(withFailedTo(99))
      expect(first?.toNodeKey).toBe(`${objectiveKeyOf('o1')}#n1`)
    })

    it('never leaves a failure tier pointing nowhere', () => {
      for (const to of ['done', 0, 99, null, 'garbage']) {
        for (const edge of failedEdges(withFailedTo(to))) expect(edge?.toNodeKey).toBeTruthy()
      }
    })
  })

  describe('a setback must cost something (2026-07-27)', () => {
    const withFailureMap = (onFailure: unknown, localAtoms: unknown) => ({
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: 'The counter.', stakes: 's',
          affordances: [{ key: 'a', hint: 'go' }], local_atoms: localAtoms, on_failure: onFailure,
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
        { kind: 'skill_challenge', narration_seed: 'The hatch.', stakes: 's',
          affordances: [{ key: 'b', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
      ] }],
    })
    const firstNode = (doc: unknown) => {
      const result = parseStage5Nodes(rawOutput(doc), ctx)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error('unreachable')
      return result.data.nodes[0].node
    }

    it('keeps an authored setback as-is', () => {
      const node = firstNode(withFailureMap(['watch_alerted'], [{ name: 'watch_alerted', kind: 'flag' }]))
      expect(node.encounter.onFailure).toEqual(['watch_alerted'])
    })

    it('banks the declared setback when the model forgot to reference it', () => {
      // Live 2026-07-26: three of five resolutions came in failed or partial and every one awarded
      // zero atoms, so a party that kept losing changed nothing about the world.
      const node = firstNode(withFailureMap([], [{ name: 'watch_alerted', kind: 'flag' }]))
      expect(node.encounter.onFailure).toEqual(['watch_alerted'])
    })

    it('repairs an omitted on_failure too, not just an empty one', () => {
      const node = firstNode(withFailureMap(undefined, [{ name: 'watch_alerted', kind: 'flag' }]))
      expect(node.encounter.onFailure).toEqual(['watch_alerted'])
    })

    it('refuses to let a setback award the objective itself', () => {
      // Live 2026-07-27: a node authored on_failure with the SAME atom as on_success, so losing
      // the scene completed the objective and the rest of its graph became unreachable. The
      // failure menu is local atoms only; a spine atom named here is dropped, then repaired.
      const spineAtom = 'ledger_recovered'
      const node = firstNode(withFailureMap([spineAtom], [{ name: 'watch_alerted', kind: 'flag' }]))
      expect(node.encounter.onFailure).not.toContain(spineAtom)
      expect(node.encounter.onFailure).toEqual(['watch_alerted'])
    })

    it('synthesizes a setback when the model declared no atoms to spend', () => {
      // Without this the stage-8 `failure_writes_nothing` gate would refuse the guide over an
      // omission code can fill in - a hard blocker on generation, not a safety net.
      const node = firstNode(withFailureMap([], []))
      expect(node.encounter.onFailure).toHaveLength(1)
      expect(node.encounter.onFailure[0]).toMatch(/recover_the_ledger.*failed/)
    })

    it('registers the synthesized setback, so it is never off-registry', () => {
      const result = parseStage5Nodes(rawOutput(withFailureMap([], [])), ctx)
      expect(result.ok).toBe(true)
      if (!result.ok) return
      const declared = new Set(result.data.localAtoms.map((a) => a.name))
      for (const node of result.data.nodes) {
        for (const atom of node.node.encounter.onFailure) expect(declared.has(atom)).toBe(true)
      }
    })
  })

  it('rejects an objective with fewer than two route nodes', () => {
    const doc = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: 'x.', affordances: [{ key: 'a', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
      ] }],
    }
    expect(parseStage5Nodes(rawOutput(doc), ctx).ok).toBe(false)
  })

  it('downgrades a social node that stages nobody, keeping its outcome maps', () => {
    // Changed 2026-07-26: hard-failing took the whole chapter down. The runtime already performs
    // exactly this downgrade at open time; doing it here means the stillborn node never stores.
    const doc = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'social', narration_seed: 'x.', npc_keys: [], affordances: [{ key: 'a', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
        { kind: 'skill_challenge', narration_seed: 'y.', affordances: [{ key: 'b', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
      ] }],
    }
    const result = parseStage5Nodes(rawOutput(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes[0].node.kind).toBe('skill_challenge')
    expect(result.data.nodes[0].node.encounter.onSuccess).toEqual(['ledger_recovered'])
  })

  it('survives content slips that used to fail the whole chapter', () => {
    // The live stage-5 abort (2026-07-26): one bad atom kind + one empty seed, four retries, no
    // guide at all. Each is now repaired in place.
    const doc = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: '',
          local_atoms: [{ name: 'watch_alerted', kind: 'fact' }],
          on_failure: ['watch_alerted'],
          affordances: [{ key: 'a', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
        { kind: 'not_a_kind', narration_seed: 'y.', affordances: [],
          transitions: [{ on: 'failed', to: 99, arrival_context: '' }] },
      ] }],
    }
    const result = parseStage5Nodes(rawOutput(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const [first, second] = result.data.nodes.map((n) => n.node)
    expect(first.narrationSeed).toContain('Recover the ledger')      // synthesized seed
    expect(first.encounter.onFailure).toEqual(['watch_alerted'])     // 'fact' coerced to a flag
    expect(second.kind).toBe('skill_challenge')                      // bogus kind coerced
    expect(second.affordances).toHaveLength(1)                       // generic chip supplied
    // A bad index used to resolve to "done", which is the dead end fixed 2026-07-27. The repair is
    // now the ladder: this is the last route node, so its setback routes to the rescue.
    expect(second.transitions.find((t) => t.on === 'failed')?.toNodeKey)
      .toBe(`${objectiveKeyOf('o1')}#r0`)
  })
})

describe('buildRescueNode', () => {
  const route = buildGuaranteedRoute({
    objectiveId: 'o1',
    title: 'Recover the ledger',
    completionPredicates: ctx.objectives[0].completionPredicates,
  })

  it('materializes a rescue node that completes the objective', () => {
    expect(route).not.toBeNull()
    const node = buildRescueNode('o1', route!)
    expect(node.role).toBe('rescue')
    expect(node.key).toBe(`${objectiveKeyOf('o1')}#r0`)
    expect(atomsSatisfy(ctx.objectives[0].completionPredicates, node.encounter.onSuccess)).toBe(true)
  })

  it('never puts designer template guidance in the narration seed', () => {
    // Regression (2026-07-26): the seed was `route.guidance`, so the narrator was handed
    // "Shape: a pursuit where ground is lost on every failure. Twist (timer): ..." as scene prose.
    const node = buildRescueNode('o1', route!)
    expect(node.narrationSeed).not.toContain('Shape:')
    expect(node.narrationSeed).not.toContain('Twist (')
    expect(node.narrationSeed).toContain('Recover the ledger')
    // It still reaches the designer, where the director's rung-4 delivery reads it.
    expect((node.encounter.params as Record<string, unknown>).guidance).toBe(route!.guidance)
  })
})

describe('node labels', () => {
  it('trims a long chip hint at a word boundary, never mid-word', () => {
    const longHint = 'force Oris to write his own name in the ledger, sealing his solitary sacrifice'
    const doc = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: 'x.', affordances: [{ key: 'a', hint: longHint }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
        { kind: 'skill_challenge', narration_seed: 'y.', affordances: [{ key: 'b', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
      ] }],
    }
    const result = parseStage5Nodes(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const label = result.data.nodes[0].node.label
    expect(label.length).toBeLessThanOrEqual(61)
    // The truncated tail must be a whole word - "sacri" was what shipped before the fix.
    expect(label).toMatch(/(\w+…|^[^…]+$)/)
    expect(label.replace('…', '').split(' ').pop()).not.toBe('sacri')
    expect(longHint.startsWith(label.replace('…', ''))).toBe(true)
  })

  it('falls back to the objective title when a chip has no hint', () => {
    const doc = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'skill_challenge', narration_seed: 'x.', affordances: [{ key: 'a', hint: '' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
        { kind: 'skill_challenge', narration_seed: 'y.', affordances: [{ key: 'b', hint: 'go' }],
          transitions: [{ on: 'full', to: 'done', arrival_context: '' }] },
      ] }],
    }
    const result = parseStage5Nodes(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes[0].node.label).toBe('Recover the ledger')
  })
})
