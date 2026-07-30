import { describe, expect, it } from 'vitest'

import {
  downgradeUnstageableNodes,
  affordanceLabel,
  nodeAwardAtoms,
  nodeKeyFor,
  parseNodeSpec,
  pruneNodeNpcIds,
  validateNodeGraph,
} from './nodes'
import type { StoryNodeSpec } from './nodes'

const ctx = { objectiveKey: 'obj:c1:o1', objectiveAtoms: ['ward_lowered', 'guards_alerted'] }

function rawNode(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    key: 'obj:c1:o1#n0',
    kind: 'skill_challenge',
    role: 'route',
    index: 0,
    label: 'Slip past the ward',
    narration_seed: 'The ward hums across the threshold, its light pulsing.',
    stakes: 'Trip it and the whole keep wakes.',
    on_success: ['ward_lowered'],
    on_partial: [],
    on_failure: ['guards_alerted'],
    affordances: [{ key: 'sneak', hint: 'time the pulses and cross' }],
    transitions: [{ on: 'full', to_node_key: null, arrival_context: '' }],
    local_atoms: [],
    ...over,
  }
}

describe('parseNodeSpec', () => {
  it('parses a well-formed node and shows the authored hint as the chip', () => {
    const result = parseNodeSpec(rawNode(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.node.encounter.onSuccess).toEqual(['ward_lowered'])
    expect(result.node.encounter.onFailure).toEqual(['guards_alerted'])
    expect(result.node.affordances[0].label).toBe('time the pulses and cross')
  })

  it('drops an outcome atom off the objective+local menu', () => {
    const result = parseNodeSpec(rawNode({ on_success: ['ward_lowered', 'invented_atom'] }), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.node.encounter.onSuccess).toEqual(['ward_lowered'])
  })

  it('admits a declared local atom into the outcome menu', () => {
    const result = parseNodeSpec(
      rawNode({ local_atoms: [{ name: 'lever_thrown', kind: 'flag' }], on_success: ['lever_thrown'] }),
      ctx,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.node.encounter.onSuccess).toEqual(['lever_thrown'])
  })

  it('requires arrival_context on a non-full edge into a node', () => {
    const result = parseNodeSpec(
      rawNode({
        transitions: [
          { on: 'full', to_node_key: null, arrival_context: '' },
          { on: 'failed', to_node_key: 'obj:c1:o1#n1', arrival_context: '' },
        ],
      }),
      ctx,
    )
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.errors.some((e) => e.includes('arrival_context'))).toBe(true)
  })

  it('rejects a missing narration seed', () => {
    const result = parseNodeSpec(rawNode({ narration_seed: '' }), ctx)
    expect(result.ok).toBe(false)
  })
})

describe('affordanceLabel', () => {
  it('shows the authored hint verbatim', () => {
    expect(affordanceLabel('social', 'reason with the warden')).toBe('reason with the warden')
  })

  it('never doubles a verb the author already wrote', () => {
    // 13% of 1193 authored chips shipped as "Attempt: Attempt to..." while code owned the prefix.
    for (const [kind, hint] of [
      ['skill_challenge', 'Attempt to sever the ledger from the leviathan'],
      ['combat', 'attempt to stop the signal'],
      ['puzzle', 'Attempt to create a new entry on the spot'],
      ['social', 'Attempt to intimidate Corl'],
    ] as const) {
      expect(affordanceLabel(kind, hint)).toBe(hint)
    }
  })

  it('still guarantees a chip says something when the hint is missing', () => {
    expect(affordanceLabel('puzzle', '')).toBe('Work out')
    expect(affordanceLabel('social', '   ')).toBe('Talk')
  })
})

describe('nodeKeyFor', () => {
  it('is deterministic and distinguishes rescue from route', () => {
    expect(nodeKeyFor('obj:c1:o1', 'route', 0)).toBe('obj:c1:o1#n0')
    expect(nodeKeyFor('obj:c1:o1', 'rescue', 0)).toBe('obj:c1:o1#r0')
  })
})

function node(over: Partial<StoryNodeSpec> = {}): StoryNodeSpec {
  return {
    key: 'n0', objectiveKey: 'o1', index: 0, kind: 'skill_challenge', role: 'route',
    label: 'x', narrationSeed: 's', locationKey: null, outcomeSummary: { win: '', loss: '' },
    pull: '',
    encounter: { kind: 'skill_challenge', label: 'x', stakes: '', rationale: '', params: {}, onSuccess: ['a'], onPartial: [], onFailure: ['setback'] },
    establishes: [],
    affordances: [{ key: 'go', label: 'Attempt: go', hint: 'go' }],
    transitions: [{ on: 'full', toNodeKey: null, arrivalContext: '' }],
    localAtoms: [],
    ...over,
  }
}

describe('validateNodeGraph', () => {
  it('passes a healthy single node', () => {
    expect(validateNodeGraph([node()])).toEqual([])
  })

  it('flags a dangling transition target', () => {
    const errs = validateNodeGraph([node({ transitions: [{ on: 'full', toNodeKey: 'ghost', arrivalContext: '' }] })])
    expect(errs.some((e) => e.includes('unknown node'))).toBe(true)
  })

  it('flags a failure self-loop with no escalation', () => {
    const errs = validateNodeGraph([
      node({
        encounter: { kind: 'skill_challenge', label: 'x', stakes: '', rationale: '', params: {}, onSuccess: ['a'], onPartial: [], onFailure: [] },
        transitions: [
          { on: 'full', toNodeKey: null, arrivalContext: '' },
          { on: 'failed', toNodeKey: 'n0', arrivalContext: 'you are forced back, winded' },
        ],
      }),
    ])
    expect(errs.some((e) => e.includes('replays the same scene'))).toBe(true)
  })

  it('allows a failure self-loop that escalates via an atom', () => {
    const errs = validateNodeGraph([
      node({
        transitions: [
          { on: 'full', toNodeKey: null, arrivalContext: '' },
          { on: 'failed', toNodeKey: 'n0', arrivalContext: 'you are forced back, the alarm rising' },
        ],
      }),
    ])
    expect(errs).toEqual([])
  })

  it('flags a node with no full-success transition', () => {
    const errs = validateNodeGraph([node({ transitions: [{ on: 'failed', toNodeKey: null, arrivalContext: '' }] })])
    expect(errs.some((e) => e.includes('no transition on a full success'))).toBe(true)
  })
})

describe('nodeAwardAtoms', () => {
  it('unions and canonicalizes the three tiers', () => {
    expect(nodeAwardAtoms(node())).toEqual(['a', 'setback'])
  })
})

describe('downgradeUnstageableNodes', () => {
  const social = (key: string, npcIds: string[]) => ({ key, kind: 'social' as const, npcIds })

  it('downgrades a social node whose cast was deleted (the stage-6 group purge)', () => {
    // Regression 2026-07-26: stage 5 staged an NPC that stage 6 then removed as a group row, so
    // the node could never open and the stage-8 gate blocked the entire guide.
    const out = downgradeUnstageableNodes([social('n0', ['deleted-npc'])], ['alive-npc'])
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ key: 'n0', from: 'social', to: 'skill_challenge' })
  })

  it('leaves a social node alone while ANY of its cast is still living', () => {
    // Correct as far as the KIND goes - one living NPC can host the scene. But surviving the
    // downgrade is not the same as being clean: the dead id stays in the spec, which is what
    // pruneNodeNpcIds below exists to strip.
    expect(downgradeUnstageableNodes([social('n0', ['gone', 'alive-npc'])], ['alive-npc'])).toEqual([])
  })

  it('downgrades a social node that stages nobody at all', () => {
    expect(downgradeUnstageableNodes([social('n0', [])], ['alive-npc'])[0].reason).toContain('nobody')
  })

  it('never touches non-social nodes', () => {
    const out = downgradeUnstageableNodes(
      [{ key: 'n1', kind: 'combat', npcIds: [] }, { key: 'n2', kind: 'puzzle', npcIds: [] }], [])
    expect(out).toEqual([])
  })
})

describe('pruneNodeNpcIds', () => {
  // The gap the downgrade left: a node staging [alive, deleted] survives as social with the
  // deleted id still in its spec. At open time resolveNpcNames throws "NPC <uuid> not found" and
  // the beat goes stillborn - live 2026-07-26, three times on one node.
  it('strips a dead id from a node that keeps its cast', () => {
    const out = pruneNodeNpcIds([{ key: 'n0', npcIds: ['gone', 'alive-npc'] }], ['alive-npc'])
    expect(out).toEqual([{ key: 'n0', npcIds: ['alive-npc'], removed: ['gone'] }])
  })

  it('reports nothing when every id is still living', () => {
    expect(pruneNodeNpcIds([{ key: 'n0', npcIds: ['alive-npc'] }], ['alive-npc'])).toEqual([])
  })

  it('reports nothing for a node that stages nobody', () => {
    expect(pruneNodeNpcIds([{ key: 'n0', npcIds: [] }], ['alive-npc'])).toEqual([])
  })

  it('empties a node whose whole cast is gone (the downgrade then handles the kind)', () => {
    const out = pruneNodeNpcIds([{ key: 'n0', npcIds: ['gone', 'also-gone'] }], ['alive-npc'])
    expect(out[0]).toMatchObject({ npcIds: [], removed: ['gone', 'also-gone'] })
  })

  it('leaves no dangling reference behind, whatever the mix', () => {
    const living = ['a', 'b']
    for (const ids of [['a'], ['a', 'x'], ['x', 'y'], ['a', 'b', 'x'], []]) {
      const [result] = pruneNodeNpcIds([{ key: 'n0', npcIds: ids }], living)
      const final = result ? result.npcIds : ids
      expect(final.every((id) => living.includes(id))).toBe(true)
    }
  })
})
