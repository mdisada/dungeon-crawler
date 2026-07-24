import { describe, expect, it } from 'vitest'

import { blockedCells, cellKey, findPath, lineOfSight, reachableCells } from './grid.ts'
import type { Combatant } from './types.ts'

const wall = (cells: [number, number][]) => new Set(cells.map(([x, y]) => cellKey(x, y)))

describe('findPath', () => {
  it('walks a straight diagonal in the open at chebyshev cost', () => {
    const path = findPath([0, 0], [4, 4], new Set())
    expect(path).not.toBeNull()
    expect(path?.length).toBe(4)
    expect(path?.[3]).toEqual([4, 4])
  })

  it('routes around a wall', () => {
    // Vertical wall at x=2 spanning y=0..3 forces a detour below.
    const blocked = wall([[2, 0], [2, 1], [2, 2], [2, 3]])
    const path = findPath([0, 1], [4, 1], blocked)
    expect(path).not.toBeNull()
    expect(path && path.length).toBeGreaterThan(4)
    expect(path?.some(([x, y]) => blocked.has(cellKey(x, y)))).toBe(false)
  })

  it('returns null when the target is sealed off', () => {
    const blocked = wall([[1, 0], [1, 1], [0, 1]])
    expect(findPath([0, 0], [5, 5], blocked)).toBeNull()
  })

  it('returns [] for the current cell and null for a blocked target', () => {
    expect(findPath([3, 3], [3, 3], new Set())).toEqual([])
    expect(findPath([0, 0], [1, 1], wall([[1, 1]]))).toBeNull()
  })

  it('takes the clean direct line in the open: diagonal toward the goal, then straight', () => {
    // (0,0) -> (6,2): two diagonals then four straight, one bend - not a zigzag.
    expect(findPath([0, 0], [6, 2], new Set())).toEqual([
      [1, 1], [2, 2], [3, 2], [4, 2], [5, 2], [6, 2],
    ])
    // Pure orthogonal target stays a straight line with zero bends.
    expect(findPath([5, 5], [5, 9], new Set())).toEqual([[5, 6], [5, 7], [5, 8], [5, 9]])
  })
})

describe('reachableCells', () => {
  it('respects the budget', () => {
    const cells = reachableCells([5, 5], 2, new Set())
    // 5x5 area minus the start cell.
    expect(cells.size).toBe(24)
    expect(cells.get(cellKey(7, 7))).toBe(2)
    expect(cells.has(cellKey(8, 5))).toBe(false)
  })

  it('excludes blocked cells and cells behind full seals', () => {
    const blocked = wall([[6, 4], [6, 5], [6, 6], [5, 4], [4, 4], [4, 5], [4, 6], [5, 6]])
    const cells = reachableCells([5, 5], 3, blocked)
    expect(cells.size).toBe(0)
  })
})

describe('lineOfSight', () => {
  it('is clear in the open and blocked by an intervening obstacle', () => {
    expect(lineOfSight([0, 0], [6, 0], new Set())).toBe(true)
    expect(lineOfSight([0, 0], [6, 0], wall([[3, 0]]))).toBe(false)
  })

  it('ignores obstacles on the endpoints', () => {
    expect(lineOfSight([0, 0], [2, 0], wall([[0, 0], [2, 0]]))).toBe(true)
  })
})

describe('blockedCells', () => {
  const combatant = (id: string, x: number, y: number, dead = false): Combatant => ({
    id, name: id, side: 'enemy', kind: 'npc', refId: null, imageUrl: null, x, y,
    hp: { current: dead ? 0 : 5, max: 5, temp: 0 }, baseHpMax: 5, ac: 10, speed: 6, dexMod: 0,
    saves: { str: 0, dex: 0, con: 0, int: 0, wis: 0, cha: 0 },
    attacks: [], spells: [], conditions: [], dead, dodging: false, disengaged: false,
    reactionAvailable: true, auto: false,
  })

  it('blocks obstacles and living combatants but not the mover or the dead', () => {
    const blocked = blockedCells([[1, 1]], [combatant('me', 2, 2), combatant('foe', 3, 3), combatant('corpse', 4, 4, true)], 'me')
    expect(blocked.has(cellKey(1, 1))).toBe(true)
    expect(blocked.has(cellKey(3, 3))).toBe(true)
    expect(blocked.has(cellKey(2, 2))).toBe(false)
    expect(blocked.has(cellKey(4, 4))).toBe(false)
  })
})
