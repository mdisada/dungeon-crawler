import { describe, expect, it } from 'vitest'

import { seededRng } from '../play/rng.ts'
import type { Rng } from '../play/rng.ts'
import { attackAdvantageDetail } from './attack.ts'
import { expectedDamage, formatDiceExpr, parseDiceExpr } from './dice.ts'
import { DIFFICULTY_PRESETS } from './difficulty.ts'
import { createCombat, editCombatant, resolveAction, setDifficulty } from './engine.ts'
import { runAutoTurn } from './heuristic.ts'
import { predictOpportunityAttacks } from './queries.ts'
import { CombatError } from './types.ts'
import type { CombatantSetup, CombatEngineState, CombatEvent } from './types.ts'

/** rng stub fed with die faces: face(15, 20) makes the next d20 roll a 15. */
const face = (value: number, sides: number) => (value - 1) / sides
const stubRng = (...values: number[]): Rng => {
  let i = 0
  return () => {
    if (i >= values.length) throw new Error('stub rng exhausted')
    return values[i++]
  }
}

const pc = (id: string, x: number, y: number, over: Partial<CombatantSetup> = {}): CombatantSetup => ({
  id, name: id, side: 'party', kind: 'pc', refId: null, imageUrl: null, x, y,
  hpMax: 20, ac: 14, speed: 6, dexMod: 2,
  attacks: [{ name: 'Longsword', kind: 'melee', toHit: 5, damage: { count: 1, sides: 8, bonus: 3 }, range: 1 }],
  ...over,
})

const foe = (id: string, x: number, y: number, over: Partial<CombatantSetup> = {}): CombatantSetup => ({
  id, name: id, side: 'enemy', kind: 'npc', refId: null, imageUrl: null, x, y,
  hpMax: 10, ac: 12, speed: 6, dexMod: 0,
  attacks: [{ name: 'Club', kind: 'melee', toHit: 3, damage: { count: 1, sides: 6, bonus: 1 }, range: 1 }],
  ...over,
})

const kinds = (events: CombatEvent[]) => events.map((e) => e.kind)
const combatant = (state: CombatEngineState, id: string) => {
  const c = state.combatants.find((x) => x.id === id)
  if (!c) throw new Error(`missing ${id}`)
  return c
}
const deadly = DIFFICULTY_PRESETS.find((d) => d.name === 'Deadly')!
const standard = DIFFICULTY_PRESETS.find((d) => d.name === 'Standard')!

describe('dice expressions', () => {
  it('parses the stat_block damage shape', () => {
    expect(parseDiceExpr('1d8+3')).toEqual({ count: 1, sides: 8, bonus: 3 })
    expect(parseDiceExpr('2d6')).toEqual({ count: 2, sides: 6, bonus: 0 })
    expect(parseDiceExpr('1d10-1')).toEqual({ count: 1, sides: 10, bonus: -1 })
    expect(() => parseDiceExpr('d6+banana')).toThrow(CombatError)
    expect(formatDiceExpr({ count: 1, sides: 8, bonus: 3 })).toBe('1d8+3')
    expect(expectedDamage({ count: 1, sides: 8, bonus: 3 })).toBe(7.5)
  })
})

describe('createCombat', () => {
  it('rolls initiative in setup order and sorts by total then DEX', () => {
    const { state, events } = createCombat(
      { combatants: [pc('a', 0, 0), foe('g', 2, 0)], obstacles: [] },
      stubRng(face(20, 20), face(1, 20)),
    )
    expect(state.initiative.map((i) => i.id)).toEqual(['a', 'g'])
    expect(state.initiative[0].total).toBe(22)
    expect(kinds(events)).toEqual(['combat_start', 'initiative', 'round_start', 'turn_start'])
    expect(state.economy).toEqual({ action: true, bonus: true, move: 6 })
  })

  it('scales enemy HP by the difficulty hp_mult, leaving baseHpMax pristine', () => {
    const { state } = createCombat(
      { combatants: [pc('a', 0, 0), foe('g', 2, 0)], obstacles: [], difficulty: deadly },
      stubRng(face(20, 20), face(1, 20)),
    )
    expect(combatant(state, 'g').hp).toEqual({ current: 15, max: 15, temp: 0 })
    expect(combatant(state, 'g').baseHpMax).toBe(10)
    expect(combatant(state, 'a').hp.max).toBe(20)
  })

  it('rejects invalid setups before rolling anything', () => {
    const noRng = stubRng()
    expect(() => createCombat({ combatants: [pc('a', 0, 0), foe('a', 1, 0)], obstacles: [] }, noRng)).toThrow(CombatError)
    expect(() => createCombat({ combatants: [pc('a', 0, 0), foe('g', 0, 0)], obstacles: [] }, noRng)).toThrow(CombatError)
    expect(() => createCombat({ combatants: [pc('a', 0, 0), pc('b', 1, 0)], obstacles: [] }, noRng)).toThrow(CombatError)
  })
})

describe('attacks', () => {
  it('resolves a hit with the full roll breakdown and applies damage', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(15, 20), face(4, 8))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 1, 0)], obstacles: [] }, rng)
    const { state, events } = resolveAction(start.state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)
    expect(kinds(events)).toEqual(['attack', 'damage'])
    const attack = events[0] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.outcome).toBe('hit')
    expect(attack.roll.total).toBe(20)
    expect(attack.damage?.total).toBe(7)
    expect(combatant(state, 'g').hp.current).toBe(3)
    expect(state.economy.action).toBe(false)
  })

  it('crits on a natural 20 with doubled dice, and ends combat on the last enemy down', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(20, 20), face(4, 8), face(5, 8))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 1, 0)], obstacles: [] }, rng)
    const { state, events } = resolveAction(start.state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)
    const attack = events[0] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.outcome).toBe('crit')
    expect(attack.damage?.total).toBe(12)
    expect(kinds(events)).toEqual(['attack', 'damage', 'down', 'combat_end'])
    expect(state.status).toBe('ended')
    expect(state.winner).toBe('party')
    expect(combatant(state, 'g').dead).toBe(true)
  })

  it('misses on a natural 1 without rolling damage', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(1, 20))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 1, 0)], obstacles: [] }, rng)
    const { events } = resolveAction(start.state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)
    expect(kinds(events)).toEqual(['attack'])
    expect((events[0] as Extract<CombatEvent, { kind: 'attack' }>).outcome).toBe('miss')
  })

  it('gives attackers disadvantage against a dodging target', () => {
    const rng = stubRng(face(1, 20), face(20, 20), face(18, 20), face(3, 20))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 1, 0)], obstacles: [] }, rng)
    let state = resolveAction(start.state, { type: 'dodge' }, rng).state
    state = resolveAction(state, { type: 'end_turn' }, rng).state
    const { events } = resolveAction(state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)
    const attack = events[0] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.roll.advantage).toBe('disadvantage')
    expect(attack.roll.dice).toEqual([18, 3])
    expect(attack.roll.used).toBe(3)
    expect(attack.outcome).toBe('miss')
  })

  it('auto-crits melee hits on an unconscious target without re-firing down', () => {
    const rng = stubRng(face(1, 20), face(2, 20), face(20, 20), face(12, 20), face(2, 20), face(3, 6), face(2, 6))
    const start = createCombat(
      { combatants: [pc('a', 0, 0), pc('b', 5, 5), foe('g', 1, 0)], obstacles: [] },
      rng,
    )
    const edited = editCombatant(start.state, 'a', { hpCurrent: 0 })
    expect(combatant(edited.state, 'a').conditions).toContain('unconscious')
    const { state, events } = resolveAction(edited.state, { type: 'attack', targetId: 'a', attackIndex: 0 }, rng)
    const attack = events[0] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.roll.advantage).toBe('advantage')
    expect(attack.outcome).toBe('crit')
    expect(kinds(events)).toEqual(['attack', 'damage'])
    expect(combatant(state, 'a').hp.current).toBe(0)
  })
})

describe('attackAdvantageDetail', () => {
  it('lists every contributing reason and nets adv vs dis', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const { state } = createCombat({ combatants: [pc('a', 0, 0), foe('g', 1, 0)], obstacles: [] }, rng)
    const a = state.combatants.find((c) => c.id === 'a')!
    const g = state.combatants.find((c) => c.id === 'g')!
    g.conditions = ['prone']
    g.dodging = true
    const detail = attackAdvantageDetail(state, a, g, a.attacks[0])
    expect(detail.advantage).toBe('none')
    expect(detail.reasons).toEqual([
      { dir: 'adv', label: 'target prone (melee)' },
      { dir: 'dis', label: 'target is dodging' },
    ])
  })
})

describe('predictOpportunityAttacks', () => {
  it('predicts exactly the enemies the engine would trigger', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const { state } = createCombat({ combatants: [pc('a', 1, 1), foe('g', 1, 0)], obstacles: [] }, rng)
    expect(predictOpportunityAttacks(state, 'a', [[1, 2], [1, 3]])).toEqual([{ id: 'g', name: 'g' }])
    expect(predictOpportunityAttacks(state, 'a', [[2, 1]])).toEqual([]) // stays adjacent
    const disengaged = JSON.parse(JSON.stringify(state)) as typeof state
    disengaged.combatants.find((c) => c.id === 'a')!.disengaged = true
    expect(predictOpportunityAttacks(disengaged, 'a', [[1, 2], [1, 3]])).toEqual([])
    const spent = JSON.parse(JSON.stringify(state)) as typeof state
    spent.combatants.find((c) => c.id === 'g')!.reactionAvailable = false
    expect(predictOpportunityAttacks(spent, 'a', [[1, 2], [1, 3]])).toEqual([])
  })
})

describe('ranged long range', () => {
  const archer = (id: string, x: number, y: number): CombatantSetup => ({
    id, name: id, side: 'party', kind: 'pc', refId: null, imageUrl: null, x, y,
    hpMax: 20, ac: 14, speed: 6, dexMod: 3,
    attacks: [{ name: 'Shortbow', kind: 'ranged', toHit: 5, damage: { count: 1, sides: 6, bonus: 3 }, range: 4, longRange: 20 }],
  })

  it('hits within normal range with no disadvantage', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(12, 20), face(4, 6))
    const start = createCombat({ combatants: [archer('a', 0, 0), foe('g', 3, 0)], obstacles: [] }, rng)
    const { events } = resolveAction(start.state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)
    const attack = events[0] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.roll.advantage).toBe('none')
    expect(attack.outcome).toBe('hit')
  })

  it('allows a shot into long range at disadvantage', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(18, 20), face(12, 20), face(4, 6))
    const start = createCombat({ combatants: [archer('a', 0, 0), foe('g', 12, 0)], obstacles: [] }, rng)
    const detail = attackAdvantageDetail(start.state, start.state.combatants[0], start.state.combatants[1], start.state.combatants[0].attacks[0])
    expect(detail.advantage).toBe('disadvantage')
    expect(detail.reasons).toContainEqual({ dir: 'dis', label: 'beyond normal range' })
    const { events } = resolveAction(start.state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)
    const attack = events[0] as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.roll.advantage).toBe('disadvantage')
    expect(attack.roll.used).toBe(12)
  })

  it('rejects a target beyond long range', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const start = createCombat({ combatants: [archer('a', 0, 0), foe('g', 25, 0)], obstacles: [] }, rng)
    expect(() => resolveAction(start.state, { type: 'attack', targetId: 'g', attackIndex: 0 }, rng)).toThrow(CombatError)
  })
})

describe('movement and opportunity attacks', () => {
  it('provokes one OA per enemy reaction, spent for the round', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(10, 20))
    const start = createCombat({ combatants: [pc('a', 1, 1), foe('g', 1, 0)], obstacles: [] }, rng)
    const away = resolveAction(start.state, { type: 'move', to: [1, 3] }, rng)
    expect(kinds(away.events)).toEqual(['attack', 'move'])
    expect((away.events[0] as Extract<CombatEvent, { kind: 'attack' }>).reaction).toBe(true)
    const back = resolveAction(away.state, { type: 'move', to: [1, 1] }, rng)
    expect(kinds(back.events)).toEqual(['move'])
    const awayAgain = resolveAction(back.state, { type: 'move', to: [1, 3] }, rng)
    expect(kinds(awayAgain.events)).toEqual(['move'])
    expect(awayAgain.state.economy.move).toBe(0)
  })

  it('disengage suppresses opportunity attacks', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const start = createCombat({ combatants: [pc('a', 1, 1), foe('g', 1, 0)], obstacles: [] }, rng)
    const state = resolveAction(start.state, { type: 'disengage' }, rng).state
    const { events } = resolveAction(state, { type: 'move', to: [1, 3] }, rng)
    expect(kinds(events)).toEqual(['move'])
  })

  it('stops movement cold when an OA drops the mover', () => {
    const rng = stubRng(face(20, 20), face(1, 20), face(15, 20), face(6, 6))
    const start = createCombat({ combatants: [pc('a', 1, 1), foe('g', 1, 0)], obstacles: [] }, rng)
    const edited = editCombatant(start.state, 'a', { hpCurrent: 2 })
    const { state, events } = resolveAction(edited.state, { type: 'move', to: [1, 3] }, rng)
    expect(kinds(events)).toEqual(['attack', 'damage', 'down', 'combat_end'])
    const a = combatant(state, 'a')
    expect([a.x, a.y]).toEqual([1, 1])
    expect(a.conditions).toContain('unconscious')
    expect(state.winner).toBe('enemy')
  })

  it('dash converts the action into extra movement', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 10, 10)], obstacles: [] }, rng)
    const { state } = resolveAction(start.state, { type: 'dash' }, rng)
    expect(state.economy.move).toBe(12)
    expect(state.economy.action).toBe(false)
  })
})

describe('difficulty and edits', () => {
  it('rescales enemy HP proportionally on mid-combat changes', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 5, 5)], obstacles: [] }, rng)
    const harder = setDifficulty(start.state, deadly)
    expect(combatant(harder.state, 'g').hp).toEqual({ current: 15, max: 15, temp: 0 })
    const wounded = editCombatant(harder.state, 'g', { hpCurrent: 5 })
    const softer = setDifficulty(wounded.state, standard)
    expect(combatant(softer.state, 'g').hp).toEqual({ current: 3, max: 10, temp: 0 })
  })

  it('an edit that zeroes the last enemy ends the combat', () => {
    const rng = stubRng(face(20, 20), face(1, 20))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 5, 5)], obstacles: [] }, rng)
    const { state, events } = editCombatant(start.state, 'g', { hpCurrent: 0 })
    expect(combatant(state, 'g').dead).toBe(true)
    expect(kinds(events)).toEqual(['edit', 'combat_end'])
    expect(state.winner).toBe('party')
  })
})

describe('minion heuristic', () => {
  it('closes to melee and attacks the nearest target', () => {
    const initRng = stubRng(face(1, 20), face(20, 20))
    const start = createCombat({ combatants: [pc('a', 0, 0), foe('g', 4, 0)], obstacles: [] }, initRng)
    expect(start.state.initiative[0].id).toBe('g')
    const { events } = runAutoTurn(start.state, seededRng(5))
    const eventKinds = kinds(events)
    expect(eventKinds).toContain('move')
    expect(eventKinds).toContain('attack')
    const move = events.find((e) => e.kind === 'move') as Extract<CombatEvent, { kind: 'move' }>
    expect(move.path[move.path.length - 1]).toEqual([1, 0])
    const attack = events.find((e) => e.kind === 'attack') as Extract<CombatEvent, { kind: 'attack' }>
    expect(attack.attackerId).toBe('g')
    expect(attack.targetId).toBe('a')
  })

  it('replays a full auto battle byte-identically under the same seed', () => {
    const runBattle = () => {
      const rng = seededRng(99)
      let { state, events } = createCombat(
        {
          combatants: [
            pc('a', 0, 0, { auto: true }), pc('b', 0, 2, { auto: true }),
            foe('g1', 8, 0), foe('g2', 8, 2),
          ],
          obstacles: [[4, 1]],
        },
        rng,
      )
      const all = [...events]
      for (let guard = 0; guard < 400 && state.status === 'active'; guard++) {
        const result = runAutoTurn(state, rng)
        state = result.state
        all.push(...result.events)
      }
      return { state, all }
    }
    const first = runBattle()
    const second = runBattle()
    expect(first.state.status).toBe('ended')
    expect(JSON.stringify(first.all)).toBe(JSON.stringify(second.all))
    expect(JSON.stringify(first.state)).toBe(JSON.stringify(second.state))
  })
})
