import { describe, expect, it } from 'vitest'

import type { Rng } from '../play/rng.ts'
import { createCombat, resolveAction } from './engine.ts'
import { cellKey } from './grid.ts'
import { spellArea, spellTargets } from './spells.ts'
import { CombatError } from './types.ts'
import type { CombatantSetup, CombatEngineState, CombatEvent, SpellSpec } from './types.ts'

const face = (value: number, sides: number) => (value - 1) / sides
const stubRng = (...values: number[]): Rng => {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('stub rng exhausted')
    return values[i++]
  }
}

const fireBolt: SpellSpec = {
  name: 'Fire Bolt', cost: 'action', effect: 'attack', range: 24, toHit: 5,
  amount: { count: 1, sides: 10, bonus: 0 }, area: { shape: 'single' },
}
const fireball: SpellSpec = {
  name: 'Fireball', cost: 'action', effect: 'save', range: 30, saveAbility: 'dex', saveDc: 15,
  onSave: 'half', amount: { count: 8, sides: 6, bonus: 0 }, area: { shape: 'circle', radius: 4 },
}
const cure: SpellSpec = {
  name: 'Cure Wounds', cost: 'action', effect: 'heal', range: 1, affects: 'allies',
  amount: { count: 1, sides: 8, bonus: 3 }, area: { shape: 'single' },
}

const caster = (id: string, x: number, y: number, spells: SpellSpec[], over: Partial<CombatantSetup> = {}): CombatantSetup => ({
  id, name: id, side: 'party', kind: 'pc', refId: null, imageUrl: null, x, y,
  hpMax: 20, ac: 13, speed: 6, dexMod: 2,
  attacks: [{ name: 'Dagger', kind: 'melee', toHit: 4, damage: { count: 1, sides: 4, bonus: 2 }, range: 1 }],
  spells, ...over,
})
const foe = (id: string, x: number, y: number, over: Partial<CombatantSetup> = {}): CombatantSetup => ({
  id, name: id, side: 'enemy', kind: 'npc', refId: null, imageUrl: null, x, y,
  hpMax: 30, ac: 12, speed: 6, dexMod: 0, saves: { dex: 0 },
  attacks: [{ name: 'Club', kind: 'melee', toHit: 3, damage: { count: 1, sides: 6, bonus: 1 }, range: 1 }],
  ...over,
})

const kinds = (events: CombatEvent[]) => events.map((e) => e.kind)
const at = (state: CombatEngineState, id: string) => state.combatants.find((c) => c.id === id)!

describe('spellArea templates', () => {
  it('circle covers a filled radius around the aim cell', () => {
    const cells = spellArea({ shape: 'circle', radius: 1 }, [0, 0], [5, 5])
    const keys = new Set(cells.map(([x, y]) => cellKey(x, y)))
    expect(keys.has(cellKey(5, 5))).toBe(true)
    expect(keys.has(cellKey(4, 5))).toBe(true)
    expect(keys.has(cellKey(6, 6))).toBe(false) // corner is hypot(1,1)~1.41 > 1, excluded
    expect(cells.length).toBe(5) // center + 4 orthogonal (corners are ~1.41 away)
  })

  it('cube is a filled square centered on the aim', () => {
    expect(spellArea({ shape: 'cube', size: 3 }, [0, 0], [10, 10]).length).toBe(9)
  })

  it('line projects a 1-wide corridor from caster toward aim', () => {
    const cells = spellArea({ shape: 'line', length: 4 }, [0, 0], [1, 0])
    expect(cells.map(([x]) => x).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(cells.every(([, y]) => y === 0)).toBe(true)
  })

  it('cone widens with distance from the caster', () => {
    const cells = spellArea({ shape: 'cone', length: 3 }, [0, 0], [1, 0])
    // all within the eastward cone, none behind the caster
    expect(cells.every(([x]) => x > 0)).toBe(true)
    expect(cells.length).toBeGreaterThan(3)
  })
})

describe('spell casting', () => {
  it('resolves an attack-roll spell like a ranged attack', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(15, 20), face(7, 10))
    const start = createCombat({ combatants: [caster('w', 0, 0, [fireBolt]), foe('g', 3, 0)], obstacles: [] }, rng)
    const { state, events } = resolveAction(start.state, { type: 'cast', spellIndex: 0, targetId: 'g' }, rng)
    expect(kinds(events)).toEqual(['spell_cast', 'attack', 'damage'])
    const attack = events[1] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.outcome).toBe('hit')
    expect(attack.damage?.total).toBe(7)
    expect(at(state, 'g').hp.current).toBe(23)
    expect(state.economy.action).toBe(false)
  })

  it('applies full damage on a failed save and half on a success', () => {
    // Two foes in the blast; g1 fails its DEX save, g2 rolls a 20 (auto-success -> half).
    const rng = stubRng(
      face(20, 20), face(1, 20), face(1, 20), // initiative w, g1, g2
      face(2, 20), // g1 save total 2 vs 15 -> fail
      ...Array(8).fill(face(3, 6)), // 8d6 = 24 full for g1
      face(20, 20), // g2 save nat 20 -> success
      ...Array(8).fill(face(3, 6)), // 8d6 = 24 -> half 12 for g2
    )
    const start = createCombat(
      { combatants: [caster('w', 0, 0, [fireball]), foe('g1', 10, 10), foe('g2', 11, 10)], obstacles: [] },
      rng,
    )
    const { state, events } = resolveAction(start.state, { type: 'cast', spellIndex: 0, aim: [10, 10] }, rng)
    const cast = events[0] as Extract<CombatEvent, { kind: 'spell_cast' }>
    expect(cast.targets.map((t) => t.id).sort()).toEqual(['g1', 'g2'])
    expect(at(state, 'g1').hp.current).toBe(6) // 30 - 24
    expect(at(state, 'g2').hp.current).toBe(18) // 30 - 12
    const saves = events.filter((e) => e.kind === 'save') as Extract<CombatEvent, { kind: 'save' }>[]
    expect(saves.map((s) => s.success)).toEqual([false, true])
  })

  it('heals an ally up to max and revives an unconscious PC', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(1, 20), face(5, 8))
    const start = createCombat(
      { combatants: [caster('cleric', 0, 0, [cure]), caster('ally', 1, 0, [], { side: 'party' }), foe('g', 5, 5)], obstacles: [] },
      rng,
    )
    const downed = at(start.state, 'ally')
    downed.hp.current = 0
    downed.conditions = ['unconscious']
    const { state, events } = resolveAction(start.state, { type: 'cast', spellIndex: 0, targetId: 'ally' }, rng)
    expect(kinds(events)).toEqual(['spell_cast', 'heal'])
    expect(at(state, 'ally').hp.current).toBe(8) // 5 + 3
    expect(at(state, 'ally').conditions).not.toContain('unconscious')
  })

  it('rejects an out-of-range or wrong-side target before rolling', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const start = createCombat({ combatants: [caster('w', 0, 0, [fireBolt]), foe('g', 30, 0)], obstacles: [] }, rng)
    expect(() => resolveAction(start.state, { type: 'cast', spellIndex: 0, targetId: 'g' }, rng)).toThrow(CombatError)
    expect(() => resolveAction(start.state, { type: 'cast', spellIndex: 0, targetId: 'w' }, rng)).toThrow(CombatError)
  })

  it('spellTargets only returns enemies inside the template', () => {
    const rng = stubRng(face(10, 20), face(10, 20), face(10, 20), face(10, 20))
    const start = createCombat(
      { combatants: [caster('w', 0, 0, [fireball]), foe('near', 10, 10), foe('far', 25, 25), caster('friend', 10, 11, [], { side: 'party' })], obstacles: [] },
      rng,
    )
    const targets = spellTargets(start.state, at(start.state, 'w'), fireball, { cell: [10, 10] })
    expect(targets.map((t) => t.id)).toEqual(['near']) // far is outside; friend is an ally
  })
})
