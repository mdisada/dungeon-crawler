import { describe, expect, it } from 'vitest'

import {
  bindPersonalSlots, MAX_PERSONAL_GOLD, parsePersonalSlots, personalAtoms, resolveSceneHandle,
} from './personal'
import type { PersonalSlot } from './personal'

const ctx = { nodeKeys: ['obj:o1#n0', 'obj:o1#n1'], wanted: 3 }

function raw(over?: unknown): string {
  return JSON.stringify(over ?? {
    slots: [
      {
        key: 'The Bereaved',
        archetype: { background_tags: ['folk hero'], class_keys: ['Fighter'], themes: ['revenge and loss'] },
        intro_seed: 'Their sister sailed on the ship that never came back.',
        objective: { label: 'Learn who gave the order', atoms: ['order_giver_named'],
          reward: { gold: 25, boon: 'A captain owes them a favour', epilogue_tag: 'avenged' } },
        overlays: [{ node_key: 'obj:o1#n0', overlay_seed: 'The ledger carries their sister\'s name.' }],
      },
    ],
  })
}

describe('parsePersonalSlots', () => {
  it('parses a slot and CODE-BUILDS its predicate from the declared atoms', () => {
    const result = parsePersonalSlots(raw(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const slot = result.data[0]
    expect(slot.key).toBe('the_bereaved')
    expect(slot.objective.predicate).toEqual({ flag: 'order_giver_named', eq: true })
    expect(slot.archetype.classKeys).toEqual(['fighter'])
    expect(slot.overlays).toHaveLength(1)
  })

  it('clamps an over-generous gold reward instead of failing', () => {
    const doc = JSON.parse(raw()) as { slots: { objective: { reward: { gold: number } } }[] }
    doc.slots[0].objective.reward.gold = 5000
    const result = parsePersonalSlots(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].objective.reward.gold).toBe(MAX_PERSONAL_GOLD)
  })

  it('drops an overlay pointing at a scene that does not exist', () => {
    const doc = JSON.parse(raw()) as { slots: { overlays: { scene: string }[] }[] }
    doc.slots[0].overlays[0].scene = 'scene#99'
    const result = parsePersonalSlots(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].overlays).toHaveLength(0)
  })

  it('rejects a slot with no personal atom', () => {
    const doc = JSON.parse(raw()) as { slots: { objective: { atoms: string[] } }[] }
    doc.slots[0].objective.atoms = []
    expect(parsePersonalSlots(JSON.stringify(doc), ctx).ok).toBe(false)
  })

  it('builds an all-chain for two atoms', () => {
    const doc = JSON.parse(raw()) as { slots: { objective: { atoms: string[] } }[] }
    doc.slots[0].objective.atoms = ['a_found', 'b_confronted']
    const result = parsePersonalSlots(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].objective.predicate).toEqual({
      all: [{ flag: 'a_found', eq: true }, { flag: 'b_confronted', eq: true }],
    })
  })
})

describe('personalAtoms', () => {
  it('lists the slug of every atom the objective reads', () => {
    const result = parsePersonalSlots(raw(), ctx)
    if (!result.ok) throw new Error('parse failed')
    expect(personalAtoms(result.data[0])).toEqual(['order_giver_named'])
  })
})

function slot(key: string, over: Partial<PersonalSlot['archetype']> = {}): PersonalSlot {
  return {
    key,
    archetype: { backgroundTags: [], classKeys: [], themes: [], ...over },
    introSeed: 's',
    objective: { label: 'l', predicate: { flag: `${key}_done`, eq: true }, reward: {} },
    overlays: [],
  }
}

describe('bindPersonalSlots', () => {
  const slots = [
    slot('bereaved', { themes: ['revenge'] }),
    slot('outsider', { classKeys: ['wizard'] }),
    slot('debtor', { backgroundTags: ['criminal'] }),
  ]

  it('matches on background, class and theme', () => {
    const bound = bindPersonalSlots([
      { id: 'c1', classKey: 'wizard' },
      { id: 'c2', backgroundKey: 'criminal' },
      { id: 'c3', text: 'driven by revenge for her brother' },
    ], slots)
    const byCharacter = new Map(bound.map((b) => [b.characterId, b.slotKey]))
    expect(byCharacter.get('c1')).toBe('outsider')
    expect(byCharacter.get('c2')).toBe('debtor')
    expect(byCharacter.get('c3')).toBe('bereaved')
  })

  it('gives every character a slot while slots remain, even with no signal', () => {
    const bound = bindPersonalSlots([{ id: 'c1' }, { id: 'c2' }], slots)
    expect(bound).toHaveLength(2)
    expect(new Set(bound.map((b) => b.slotKey)).size).toBe(2)
  })

  it('never assigns one slot twice, and stops when slots run out', () => {
    const bound = bindPersonalSlots([{ id: 'c1' }, { id: 'c2' }, { id: 'c3' }, { id: 'c4' }], slots)
    expect(bound).toHaveLength(3)
    expect(new Set(bound.map((b) => b.slotKey)).size).toBe(3)
  })

  it('is deterministic', () => {
    const characters = [{ id: 'c1' }, { id: 'c2' }]
    expect(bindPersonalSlots(characters, slots)).toEqual(bindPersonalSlots(characters, slots))
  })
})

describe('scene handles (2026-07-26 regression)', () => {
  it('resolves scene#N to the Nth node key shown', () => {
    expect(resolveSceneHandle('scene#2', ['a', 'b', 'c'])).toBe('b')
    expect(resolveSceneHandle(' scene#1 ', ['a'])).toBe('a')
    expect(resolveSceneHandle('scene#9', ['a'])).toBeNull()
    expect(resolveSceneHandle('obj:uuid#n0', ['a'])).toBeNull()
  })

  it('attaches the overlay via a short handle', () => {
    // Node keys embed a raw UUID; asking the model to transcribe one dropped EVERY overlay on
    // EVERY slot live, which then failed the stage-8 gate and blocked the whole guide.
    const result = parsePersonalSlots(raw(), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].overlays).toHaveLength(1)
    expect(result.data[0].overlays[0].nodeKey).toBe(ctx.nodeKeys[0])
  })

  it('still accepts a verbatim key, so a hand-edited row parses', () => {
    const doc = JSON.parse(raw()) as { slots: { overlays: Record<string, string>[] }[] }
    doc.slots[0].overlays[0] = { node_key: ctx.nodeKeys[1], overlay_seed: 'hand-written' }
    const result = parsePersonalSlots(JSON.stringify(doc), ctx)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.data[0].overlays[0].nodeKey).toBe(ctx.nodeKeys[1])
  })
})
