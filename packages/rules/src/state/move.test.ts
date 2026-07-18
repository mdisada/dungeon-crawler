import { describe, expect, it } from 'vitest'

import { applyDiff } from './diff.ts'
import { moveCost, moveDiff, validateMove } from './move.ts'
import { initialGameState } from './types.ts'
import type { CombatState, GameState, TokenState } from './types.ts'

function token(over: Partial<TokenState>): TokenState {
  return {
    id: 't1', kind: 'pc', refId: 'c1', name: 'Ash', imageUrl: null, x: 5, y: 5,
    hp: { current: 10, max: 10, temp: 0 }, conditions: [], allegiance: 'party',
    controller: 'player', controllerUserId: 'u1', speed: 6,
    ...over,
  }
}

function battleState(tokens: TokenState[], over: Partial<CombatState> = {}): GameState {
  const combat: CombatState = {
    locationId: 'loc', mapUrl: null, obstacles: [[7, 5]], tokens,
    initiative: tokens.map((t, i) => ({ tokenId: t.id, roll: 20 - i })),
    round: 1, activeTokenId: tokens[0].id,
    economy: { action: true, bonus: true, move: 6, reaction: true },
    ...over,
  }
  return { ...initialGameState(), combat }
}

const player = { userId: 'u1', isDm: false }
const dm = { userId: 'dm', isDm: true }

describe('validateMove', () => {
  it('accepts a legal in-range move and reports its cost', () => {
    const state = battleState([token({})])
    const verdict = validateMove(state, 't1', { x: 8, y: 8 }, player)
    expect(verdict).toMatchObject({ ok: true, cost: 3 })
  })

  it('rejects moves outside the grid, onto obstacles, and onto occupied squares', () => {
    const state = battleState([token({}), token({ id: 't2', controllerUserId: 'u2', x: 6, y: 5 })])
    expect(validateMove(state, 't1', { x: -1, y: 5 }, player)).toMatchObject({ ok: false, reason: 'Outside the map' })
    expect(validateMove(state, 't1', { x: 32, y: 5 }, player)).toMatchObject({ ok: false, reason: 'Outside the map' })
    expect(validateMove(state, 't1', { x: 7, y: 5 }, player)).toMatchObject({ ok: false, reason: 'Blocked square' })
    expect(validateMove(state, 't1', { x: 6, y: 5 }, player)).toMatchObject({ ok: false, reason: 'Square occupied' })
  })

  it('rejects moving someone else’s token, off-turn moves, and over-budget moves', () => {
    const state = battleState([token({}), token({ id: 't2', controllerUserId: 'u2', x: 10, y: 10 })])
    expect(validateMove(state, 't2', { x: 11, y: 10 }, player)).toMatchObject({ ok: false, reason: 'Not your token' })

    const offTurn = battleState([token({}), token({ id: 't2', controllerUserId: 'u2', x: 10, y: 10 })], { activeTokenId: 't2' })
    expect(validateMove(offTurn, 't1', { x: 6, y: 6 }, player)).toMatchObject({ ok: false, reason: 'Not your turn' })

    const tired = battleState([token({})], { economy: { action: true, bonus: true, move: 2, reaction: true } })
    expect(validateMove(tired, 't1', { x: 10, y: 5 }, player)).toMatchObject({ ok: false, reason: 'Not enough movement' })
  })

  it('lets the DM move any token anytime at zero cost', () => {
    const state = battleState([token({})], { activeTokenId: 'nobody' })
    expect(validateMove(state, 't1', { x: 30, y: 30 }, dm)).toMatchObject({ ok: true, cost: 0 })
  })

  it('rejects when no battle is active', () => {
    expect(validateMove(initialGameState(), 't1', { x: 1, y: 1 }, player)).toMatchObject({ ok: false, reason: 'No active battle' })
  })
})

describe('moveDiff', () => {
  it('commits the position and decrements movement', () => {
    const state = battleState([token({})])
    const verdict = validateMove(state, 't1', { x: 8, y: 8 }, player)
    if (!verdict.ok) throw new Error('expected ok')
    const next = applyDiff(state, moveDiff(state.combat!, 't1', { x: 8, y: 8 }, verdict.cost))
    expect(next.combat?.tokens[0]).toMatchObject({ x: 8, y: 8 })
    expect(next.combat?.economy.move).toBe(3)
  })

  it('DM move (cost 0) leaves the active turn budget alone', () => {
    const state = battleState([token({})])
    const next = applyDiff(state, moveDiff(state.combat!, 't1', { x: 1, y: 1 }, 0))
    expect(next.combat?.tokens[0]).toMatchObject({ x: 1, y: 1 })
    expect(next.combat?.economy.move).toBe(6)
  })
})

describe('moveCost', () => {
  it('is Chebyshev distance', () => {
    expect(moveCost({ x: 0, y: 0 }, { x: 3, y: 1 })).toBe(3)
    expect(moveCost({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0)
  })
})
