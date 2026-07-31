import { describe, expect, it } from 'vitest'


import { buildRescueNode, buildStage5NodesPrompt, objectiveKeyOf, parseSocialExits, parseStage5Nodes } from './stage5-nodes'
import type { Stage5NodesContext } from './stage5-nodes'
import { atomsSatisfy, buildGuaranteedRoute } from '../guaranteed-route'
import { validateNodeGraph } from '../nodes'

const ctx: Stage5NodesContext = {
  chapterNumber: 1,
  chapterTitle: 'The Drowned Ledger',
  locations: [],
  scenes: [],
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
  it('parses two route nodes and DERIVES establishes from the objective predicate', () => {
    const result = parseStage5Nodes(rawOutput(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes).toHaveLength(2)
    for (const { node } of result.data.nodes) {
      // The plot fact rides on `establishes` and is credited when the node RESOLVES, at any
      // tier - not on `onSuccess`, which would make the fact the prize for winning (2026-07-29).
      expect(node.establishes).toEqual(['ledger_recovered'])
      expect(atomsSatisfy(ctx.objectives[0].completionPredicates, node.establishes)).toBe(true)
      expect(node.encounter.onSuccess).toEqual([])
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

  describe('the model writes fiction and picks menus, nothing structural (2026-07-27)', () => {
    // The new contract: no transitions, no on_failure, no local_atoms array. Just prose, a kind,
    // npc keys, chips, one setback and one setback line.
    const proseOnly = {
      objectives: [{ objective_number: 1, nodes: [
        { kind: 'social', narration_seed: 'Mara guards the strongbox.', stakes: 'She can call the watch.',
          npc_keys: ['npc:mara'], affordances: [{ key: 'press', hint: 'talk her round' }],
          setback: { name: 'watch_alerted', kind: 'flag' },
          setback_line: 'Rebuffed, the party eyes the cellar hatch.' },
        { kind: 'skill_challenge', narration_seed: 'The hatch is barred.', stakes: 'Noise carries.',
          affordances: [{ key: 'force', hint: 'force it quietly' }],
          setback: { name: 'timbers_splintered', kind: 'flag' },
          setback_line: 'The hatch holds; only the front way is left.' },
      ] }],
    }
    const parsed = () => {
      const r = parseStage5Nodes(rawOutput(proseOnly), ctx)
      expect(r.ok).toBe(true)
      if (!r.ok) throw new Error(r.errors.join('; '))
      return r.data
    }

    it('parses a node that authors no structure at all', () => {
      const { nodes } = parsed()
      expect(nodes).toHaveLength(2)
      expect(nodes[0].node.narrationSeed).toContain('Mara')
    })

    it('derives the full-success edge as resolving the objective', () => {
      const full = parsed().nodes[0].node.transitions.find((t) => t.on === 'full')
      expect(full).toEqual({ on: 'full', toNodeKey: null, arrivalContext: '' })
    })

    it('derives the failure ladder: route 0 -> route 1 -> rescue', () => {
      const [first, last] = parsed().nodes.map((n) => n.node)
      const key = objectiveKeyOf('o1')
      expect(first.transitions.find((t) => t.on === 'failed')?.toNodeKey).toBe(`${key}#n1`)
      expect(last.transitions.find((t) => t.on === 'failed')?.toNodeKey).toBe(`${key}#r0`)
    })

    it('carries the setback line onto the failure edge', () => {
      const failed = parsed().nodes[0].node.transitions.find((t) => t.on === 'failed')
      expect(failed?.arrivalContext).toBe('Rebuffed, the party eyes the cellar hatch.')
    })

    it('spends exactly the declared setback on failure', () => {
      expect(parsed().nodes[0].node.encounter.onFailure).toEqual(['watch_alerted'])
      expect(parsed().nodes[0].node.localAtoms.map((a) => a.name)).toEqual(['watch_alerted'])
    })

    it('emits exactly two edges - there is no third outcome to author', () => {
      for (const { node } of parsed().nodes) {
        expect(node.transitions.map((t) => t.on).sort()).toEqual(['failed', 'full'])
      }
    })

    it('supplies an honest default when the setback line is missing', () => {
      const noLine = JSON.parse(JSON.stringify(proseOnly))
      delete noLine.objectives[0].nodes[0].setback_line
      const r = parseStage5Nodes(rawOutput(noLine), ctx)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      const failed = r.data.nodes[0].node.transitions.find((t) => t.on === 'failed')
      expect(failed?.arrivalContext).toContain('fails')
    })

    it('still accepts the old shape, so a model reverting to it does not fail a chapter', () => {
      const r = parseStage5Nodes(rawOutput(), ctx)
      expect(r.ok).toBe(true)
      if (!r.ok) return
      expect(r.data.nodes[0].node.encounter.onFailure).toEqual(['watch_alerted'])
      expect(r.data.nodes[0].node.transitions.find((t) => t.on === 'failed')?.arrivalContext)
        .toContain('cellar')
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

  it('downgrades a social node that stages nobody, keeping what it establishes', () => {
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
    expect(result.data.nodes[0].node.establishes).toEqual(['ledger_recovered'])
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

describe('nodes are placed (2026-07-28)', () => {
  const placedCtx: Stage5NodesContext = {
    ...ctx,
    locations: [{ key: 'loc:office', name: 'The Harbour Office' }, { key: 'loc:quay', name: 'The Quay' }],
  }
  const doc = (first: Record<string, unknown>) => JSON.stringify({
    objectives: [{ objective_number: 1, nodes: [
      { kind: 'skill_challenge', narration_seed: 'x.', affordances: [{ key: 'a', hint: 'go' }],
        transitions: [{ on: 'full', to: 'done', arrival_context: '' }], ...first },
      { kind: 'skill_challenge', narration_seed: 'y.', affordances: [{ key: 'b', hint: 'go' }],
        transitions: [{ on: 'full', to: 'done', arrival_context: '' }], location_key: 'loc:quay' },
    ] }],
  })

  it('keeps a location the chapter actually has', () => {
    const result = parseStage5Nodes(doc({ location_key: 'loc:office' }), placedCtx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes[0].node.locationKey).toBe('loc:office')
  })

  it('rejects a node left unplaced when the chapter has places to choose from', () => {
    const result = parseStage5Nodes(doc({}), placedCtx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/no valid location_key/)
  })

  it('rejects an invented place rather than storing a dangling reference', () => {
    const result = parseStage5Nodes(doc({ location_key: 'loc:the_sunken_cathedral' }), placedCtx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toMatch(/no valid location_key/)
  })

  it('asks for nothing when the chapter has no locations at all', () => {
    const result = parseStage5Nodes(doc({}), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes[0].node.locationKey).toBeNull()
  })
})

describe('the chapter plan reaches the node author', () => {
  // Stage 2's scenes were loaded for stages 3 and 4 and dropped before stage 5b, so the chapter
  // got decomposed twice by models that never compared notes.
  it('puts the planned scenes in the prompt', () => {
    const prompt = buildStage5NodesPrompt({
      ...ctx,
      scenes: ['Mira Coth shows the party her brother\'s ship in the ledger; it never docked.'],
    })
    expect(prompt.user).toContain('brother\'s ship')
    expect(prompt.user).toContain('planned around')
  })

  it('omits the block entirely when a chapter has no scenes on file', () => {
    expect(buildStage5NodesPrompt(ctx).user).not.toContain('planned around')
  })
})

describe('what the rest of the guide already built reaches the node author', () => {
  // Live: Dr. Elara Vance held 2 of a chapter's 8 clues and appeared in none of its 12 nodes. A
  // clue on a person only ever comes out in conversation, so nothing could reach those two.
  it('marks who is holding the evidence, and where it is hidden', () => {
    const { user } = buildStage5NodesPrompt({
      ...ctx,
      npcs: [{ key: 'npc:mara', name: 'Harbormaster Mara', clues: 2 }, { key: 'npc:tam', name: 'Tam', clues: 0 }],
      locations: [{ key: 'loc:office', name: 'The Office', clues: 1 }, { key: 'loc:dock', name: 'The Dock', clues: 0 }],
    })
    expect(user).toContain('holds 2 clues')
    expect(user).toContain('1 clue here')
    // Nothing is claimed about the empty-handed ones.
    expect(user).not.toContain('holds 0')
    expect(user).not.toContain('0 clues here')
  })

  // Stage 5 runs once per objective, so "at least one combat somewhere" was an instruction no
  // single call could follow. The Frayed Threads shipped 0 combat nodes.
  it('says a fight is still owed when nothing has drawn steel yet', () => {
    const { user } = buildStage5NodesPrompt({ ...ctx, authoredKinds: { social: 2, skill_challenge: 3 } })
    expect(user).toContain('social x2')
    expect(user).toContain('No COMBAT scene exists yet')
  })

  it('says combat is covered once one exists, and closed once the ceiling is hit', () => {
    expect(buildStage5NodesPrompt({ ...ctx, authoredKinds: { combat: 1 } }).user).toContain('Combat is covered')
    expect(buildStage5NodesPrompt({ ...ctx, authoredKinds: { combat: 3 } }).user).toContain('at its ceiling')
  })

  it('omits the tally entirely for a caller that does not track it', () => {
    expect(buildStage5NodesPrompt(ctx).user).not.toContain('already authored elsewhere')
  })
})

describe('outcome summaries (the ladder contract)', () => {
  it('stores the authored win/loss pair', () => {
    const result = parseStage5Nodes(rawOutput({
      objectives: [{
        objective_number: 1,
        nodes: [
          {
            kind: 'social', narration_seed: 'Mara guards the strongbox.', stakes: 's',
            npc_keys: ['npc:mara'], affordances: [{ key: 'persuade', hint: 'talk' }],
            setback: { name: 'watch_alerted', kind: 'flag' },
            setback_line: 'Rebuffed, the party eyes the cellar hatch.',
            outcome: { win: 'The party holds the ledger.', loss: 'Mara has the watch watching the party.' },
          },
          {
            kind: 'skill_challenge', narration_seed: 'The hatch is barred.', stakes: 's',
            affordances: [{ key: 'break_in', hint: 'force it' }],
            setback: { name: 'hatch_jammed', kind: 'flag' }, setback_line: 'The hatch holds.',
            outcome: { win: 'The party is inside with the ledger.', loss: 'The cellar stays shut.' },
          },
        ],
      }],
    }), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data.nodes[0].node.outcomeSummary).toEqual({
      win: 'The party holds the ledger.', loss: 'Mara has the watch watching the party.',
    })
  })

  it('derives a summary rather than failing the chapter when none is authored', () => {
    const result = parseStage5Nodes(rawOutput(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const first = result.data.nodes[0].node.outcomeSummary
    expect(first.win).toContain('Recover the ledger')
    expect(first.loss).toBe('Rebuffed, the party eyes the cellar hatch.')
  })

  it('REJECTS two routes of one objective declaring the SAME loss', () => {
    // Guide ac78e517: both climax routes carried "the Drowned Corpus completes its manifestation,
    // Mirehaven silenced" - the objective lost outright, recorded twice, on routes meant to lead on.
    const result = parseStage5Nodes(rawOutput({
      objectives: [{
        objective_number: 1,
        nodes: [
          {
            kind: 'social', narration_seed: 'Mara guards the strongbox.', stakes: 's',
            npc_keys: ['npc:mara'], affordances: [{ key: 'persuade', hint: 'talk' }],
            setback: { name: 'watch_alerted', kind: 'flag' }, setback_line: 'Rebuffed.',
            outcome: { win: 'They hold the ledger.', loss: 'The town is lost and the ledger burns.' },
          },
          {
            kind: 'skill_challenge', narration_seed: 'The hatch is barred.', stakes: 's',
            affordances: [{ key: 'break_in', hint: 'force it' }],
            setback: { name: 'hatch_jammed', kind: 'flag' }, setback_line: 'The hatch holds.',
            outcome: { win: 'They are inside.', loss: 'The town is lost and the ledger burns.' },
          },
        ],
      }],
    }), ctx)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.join(' ')).toContain('SAME loss')
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
    // A rescue is the floor a spent party is dropped onto, so its plot fact cannot be
    // conditional on winning it - objective 0 of run 9a5f87a6 lost its canon on a 0-2 roll.
    expect(atomsSatisfy(ctx.objectives[0].completionPredicates, node.establishes)).toBe(true)
    expect(node.encounter.onSuccess).toEqual([])
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

describe('parseSocialExits', () => {
  it('keeps well-formed authored exits', () => {
    const exits = parseSocialExits([
      { outcome: 'she_names_the_buyer', description: 'Maren gives up the name.', tier: 'success' },
      { outcome: 'she_wants_paying', description: 'She talks, for coin.', tier: 'partial' },
      { outcome: 'she_closes_ranks', description: 'The door shuts.', tier: 'failure' },
    ], 'Find the buyer')
    expect(exits.map((e) => e.tier)).toEqual(['success', 'partial', 'failure'])
    expect(exits[0].outcome).toBe('she_names_the_buyer')
  })

  it('ALWAYS leaves a way out that is not a loss', () => {
    // 0 of 57 social nodes across 23 guides had exits at all, so every conversation ever played
    // resolved `failed` whatever the player said. A failure-only set is the same bug.
    const failureOnly = parseSocialExits([
      { outcome: 'she_closes_ranks', description: 'The door shuts.', tier: 'failure' },
    ], 'Find the buyer')
    expect(failureOnly.some((e) => e.tier !== 'failure')).toBe(true)
    // and the authored failure survives beside the synthesized way out
    expect(failureOnly.some((e) => e.outcome === 'she_closes_ranks')).toBe(true)
  })

  it('synthesizes a usable pair when nothing is authored', () => {
    const exits = parseSocialExits(undefined, 'Find the buyer')
    expect(exits.length).toBeGreaterThanOrEqual(2)
    expect(exits.some((e) => e.tier === 'success')).toBe(true)
    expect(exits.some((e) => e.tier === 'failure')).toBe(true)
    for (const e of exits) expect(e.outcome).toMatch(/^[a-z0-9_]+$/)
  })

  it('drops malformed entries rather than the chapter', () => {
    const exits = parseSocialExits(
      [null, 42, { description: 'no outcome' }, { outcome: 'she_talks', tier: 'success' }],
      'Find the buyer',
    )
    expect(exits.some((e) => e.outcome === 'she_talks')).toBe(true)
  })
})

describe('per-objective authoring (2026-07-29)', () => {
  // Stage 5 is called once per objective now: one call for a whole chapter ran to 4000 output
  // tokens (the cap, so truncated) and 83s, blowing the edge wall clock and failing the guide.
  const oneObjectiveCtx = { ...ctx, objectives: [ctx.objectives[0]], otherObjectiveTitles: ['Break the Drowned Accord'] }

  it('names the sibling objectives without authoring them', () => {
    const { user } = buildStage5NodesPrompt(oneObjectiveCtx)
    expect(user).toContain('Break the Drowned Accord')
    expect(user).toMatch(/authored SEPARATELY/)
    // Only the one objective is up for authoring.
    expect(user).toContain(ctx.objectives[0].title)
  })

  it('omits the sibling block entirely when there are no siblings', () => {
    const { user } = buildStage5NodesPrompt({ ...ctx, objectives: [ctx.objectives[0]] })
    expect(user).not.toMatch(/authored SEPARATELY/)
  })

  it('parses a single-objective response against a single-objective context', () => {
    // objective_number is bounded by ctx.objectives.length, so a narrowed context must still
    // resolve index 0 - that is the whole reason the split is safe to do at the caller.
    const result = parseStage5Nodes(rawOutput(), oneObjectiveCtx)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data.nodes.length).toBeGreaterThan(0)
  })
})
