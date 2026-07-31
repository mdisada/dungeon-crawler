import { describe, expect, it } from 'vitest'

import { seededRng } from '../play/rng.ts'
import { activeCombatant, createCombat, resolveAction } from './engine.ts'
import { awaitsPlayer, runAiTurns, stepRng } from './turn.ts'
import type { CombatantSetup, CombatEngineState } from './types.ts'

const pc = (id: string, x: number, y: number, over: Partial<CombatantSetup> = {}): CombatantSetup => ({
  id, name: id, side: 'party', kind: 'pc', refId: null, imageUrl: null, x, y,
  hpMax: 30, ac: 15, speed: 6, dexMod: 2, auto: false,
  attacks: [{ name: 'Longsword', kind: 'melee', toHit: 5, damage: { count: 1, sides: 8, bonus: 3 }, range: 1 }],
  ...over,
})

const foe = (id: string, x: number, y: number, over: Partial<CombatantSetup> = {}): CombatantSetup => ({
  id, name: id, side: 'enemy', kind: 'npc', refId: null, imageUrl: null, x, y,
  hpMax: 8, ac: 11, speed: 6, dexMod: 0, auto: true,
  attacks: [{ name: 'Club', kind: 'melee', toHit: 3, damage: { count: 1, sides: 6, bonus: 1 }, range: 1 }],
  ...over,
})

/** A fight whose initiative order is forced, so "whose turn" is a fact and not a die roll. */
function fight(order: string[], combatants: CombatantSetup[]): CombatEngineState {
  const { state } = createCombat({ combatants, obstacles: [] }, seededRng(7))
  return {
    ...state,
    initiative: order.map((id, i) => ({ id, total: 20 - i })),
    turnIndex: 0,
  }
}

describe('stepRng', () => {
  it('is deterministic in both seed and step', () => {
    expect(stepRng(99, 3)()).toBe(stepRng(99, 3)())
  })

  it('gives adjacent steps unrelated streams', () => {
    // Seeding straight off `seed + step` would make consecutive turns roll near-identically -
    // the one way a per-action stream could be worse than the shared one it replaces.
    const four = stepRng(99, 4)
    const five = stepRng(99, 5)
    const a = Array.from({ length: 5 }, () => four())
    const b = Array.from({ length: 5 }, () => five())
    expect(a).not.toEqual(b)
  })
})

describe('runAiTurns', () => {
  it('stops the moment a human-controlled combatant is up', () => {
    // runAutoTurn ignores `auto` and would happily play the party's turn for them.
    const state = fight(['e1', 'p1'], [pc('p1', 0, 0), foe('e1', 10, 10)])
    const result = runAiTurns(state, 42, 0, null)
    expect(activeCombatant(result.state).id).toBe('p1')
    expect(result.step).toBe(1)
    expect(result.events.length).toBeGreaterThan(0)
  })

  it('does nothing when the player is already up', () => {
    const state = fight(['p1', 'e1'], [pc('p1', 0, 0), foe('e1', 10, 10)])
    const result = runAiTurns(state, 42, 4, null)
    expect(result.state).toBe(state)
    expect(result.step).toBe(4)
    expect(result.events).toEqual([])
  })

  it('plays consecutive AI turns in one pass', () => {
    const state = fight(['e1', 'e2', 'p1'], [pc('p1', 0, 0), foe('e1', 10, 10), foe('e2', 11, 11)])
    const result = runAiTurns(state, 42, 0, null)
    expect(activeCombatant(result.state).id).toBe('p1')
    expect(result.step).toBe(2)
  })

  it('halts on a finished fight rather than looping on a corpse', () => {
    const state = fight(['e1', 'p1'], [pc('p1', 0, 0), foe('e1', 10, 10)])
    const ended = { ...state, status: 'ended', winner: 'party' } as CombatEngineState
    expect(runAiTurns(ended, 42, 0, null).step).toBe(0)
  })

  it('advances the step counter so no two actions share dice', () => {
    const state = fight(['p1', 'e1'], [pc('p1', 0, 0), foe('e1', 10, 10)])
    const afterPlayer = resolveAction(state, { type: 'end_turn' }, stepRng(42, 0))
    const result = runAiTurns(afterPlayer.state, 42, 1, null)
    expect(result.step).toBeGreaterThan(1)
  })
})

describe('awaitsPlayer', () => {
  it('is true exactly when the fight is live and a person is up', () => {
    const waiting = fight(['p1', 'e1'], [pc('p1', 0, 0), foe('e1', 10, 10)])
    expect(awaitsPlayer(waiting, null)).toBe(true)
    expect(awaitsPlayer(fight(['e1', 'p1'], [pc('p1', 0, 0), foe('e1', 10, 10)]), null)).toBe(false)
    expect(awaitsPlayer({ ...waiting, status: 'ended' } as CombatEngineState, null)).toBe(false)
  })

  it('is false once the boss is down, however many minions still stand', () => {
    const state = fight(['p1', 'e1'], [pc('p1', 0, 0), foe('e1', 10, 10)])
    const bossDown = {
      ...state,
      combatants: state.combatants.map((c) => (c.id === 'e1' ? { ...c, dead: true } : c)),
    }
    expect(awaitsPlayer(bossDown, 'e1')).toBe(false)
  })
})
