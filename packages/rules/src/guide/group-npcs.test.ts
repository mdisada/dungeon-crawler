import { describe, expect, it } from 'vitest'

import {
  creatureKey, groupEnemyKeys, groupNpcIds, isGroupName, parseGroupClassifier,
} from './group-npcs.ts'

describe('creatureKey', () => {
  it('normalizes punctuation and case, folding one trailing plural', () => {
    expect(creatureKey("Thorne's Agents")).toBe('thorne s agent')
    expect(creatureKey("Thorne's Agent")).toBe('thorne s agent')
    expect(creatureKey('Silver Scale Guild Guards')).toBe('silver scale guild guard')
  })

  it('leaves short names ending in s untouched', () => {
    expect(creatureKey('s')).toBe('s')
  })
})

describe('groupEnemyKeys', () => {
  it('collects only enemies fielded 2+ at a time', () => {
    const keys = groupEnemyKeys([
      { enemies: [{ name: "Thorne's Agent", count: 3 }] },
      { enemies: [{ name: 'Volgarth', count: 1 }] },
      { summary: 'no combat' } as never,
    ])
    expect(keys.has('thorne s agent')).toBe(true)
    expect(keys.has('volgarth')).toBe(false)
  })
})

describe('groupNpcIds', () => {
  const encounters = [
    { enemies: [{ name: "Thorne's Agent", count: 2 }, { name: 'Cave Bat', count: 4 }] },
    { enemies: [{ name: 'Volgarth', count: 1 }] },
  ]

  it('flags an npc whose name is a countable-2+ enemy, plural-tolerant', () => {
    const ids = groupNpcIds(
      [
        { id: 'n1', name: "Thorne's Agents" }, // plural of the enemy -> group
        { id: 'n2', name: 'Elara Voss' }, // a real individual -> kept
      ],
      encounters,
    )
    expect(ids).toEqual(['n1'])
  })

  it('never flags a solo (count 1) combatant - a boss or duelist stays an NPC', () => {
    const ids = groupNpcIds([{ id: 'b1', name: 'Volgarth' }], encounters)
    expect(ids).toEqual([])
  })

  it('does not flag an individual whose name merely CONTAINS an enemy word', () => {
    // "Guard Captain Vex" contains "Guard" but is one person; identity match, not substring.
    const ids = groupNpcIds(
      [{ id: 'p1', name: 'Guard Captain Vex' }],
      [{ enemies: [{ name: 'Guard', count: 5 }] }],
    )
    expect(ids).toEqual([])
  })

  it('returns nothing when there are no group encounters', () => {
    expect(groupNpcIds([{ id: 'n1', name: 'Anyone' }], [])).toEqual([])
  })
})

describe('isGroupName', () => {
  const encounters = [{ enemies: [{ name: "Thorne's Agent", count: 2 }] }]
  it('is true for a count>=2 enemy name, plural-tolerant', () => {
    expect(isGroupName("Thorne's Agents", encounters)).toBe(true)
  })
  it('is false for an unrelated individual', () => {
    expect(isGroupName('Elara Voss', encounters)).toBe(false)
  })
})

describe('parseGroupClassifier', () => {
  it('parses group numbers into deduped 0-based indices', () => {
    const result = parseGroupClassifier('{"groups": [1, 3, 3]}', 3)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([0, 2])
  })

  it('accepts an empty list', () => {
    const result = parseGroupClassifier('{"groups": []}', 3)
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.data).toEqual([])
  })

  it('rejects an out-of-range index', () => {
    const result = parseGroupClassifier('{"groups": [4]}', 3)
    expect(result.ok).toBe(false)
  })
})
