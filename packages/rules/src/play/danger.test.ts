import { describe, expect, it } from 'vitest'

import {
  dangerScore, fallbackEncounterTable, parseEncounterTable, pickWeighted, rollSpawn, spawnThreshold,
} from './danger.ts'
import { seededRng } from './rng.ts'

describe('dangerScore', () => {
  it('starts from the authored base', () => {
    expect(dangerScore(3, { night: false, antagonistStep: 0, noiseEvents: 0 })).toBe(3)
  })

  it('layers night, antagonist progress, and noise', () => {
    expect(dangerScore(2, { night: true, antagonistStep: 1, noiseEvents: 1 })).toBe(5)
  })

  it('caps antagonist and noise contributions at +2 each', () => {
    expect(dangerScore(0, { night: false, antagonistStep: 9, noiseEvents: 9 })).toBe(4)
  })

  it('clamps the authored base to 0-5 and the total to 10', () => {
    expect(dangerScore(99, { night: true, antagonistStep: 9, noiseEvents: 9 })).toBe(10)
    expect(dangerScore(-3, { night: false, antagonistStep: 0, noiseEvents: 0 })).toBe(0)
  })
})

describe('spawnThreshold + rollSpawn', () => {
  it('is 8 percent per point, capped at 60', () => {
    expect(spawnThreshold(0)).toBe(0)
    expect(spawnThreshold(3)).toBe(24)
    expect(spawnThreshold(10)).toBe(60)
  })

  it('never spawns at score 0 and reports the roll', () => {
    const out = rollSpawn(seededRng(42), 0)
    expect(out.spawned).toBe(false)
    expect(out.threshold).toBe(0)
    expect(out.roll).toBeGreaterThanOrEqual(0)
  })

  it('is deterministic for a fixed seed', () => {
    const a = rollSpawn(seededRng(7), 5)
    const b = rollSpawn(seededRng(7), 5)
    expect(a).toEqual(b)
  })
})

describe('pickWeighted', () => {
  const entries = [
    { weight: 3, kind: 'skill_challenge' as const, label: 'hazard', params: {} },
    { weight: 1, kind: 'combat' as const, label: 'ambush', params: {} },
  ]

  it('respects weights over many draws', () => {
    const rng = seededRng(123)
    const counts = { hazard: 0, ambush: 0 }
    for (let i = 0; i < 400; i++) {
      const pick = pickWeighted(rng, entries)!
      counts[pick.label as 'hazard' | 'ambush']++
    }
    expect(counts.hazard).toBeGreaterThan(counts.ambush * 2)
    expect(counts.ambush).toBeGreaterThan(0)
  })

  it('ignores zero-weight entries and handles empty tables', () => {
    expect(pickWeighted(seededRng(1), [{ weight: 0, kind: 'combat', label: 'never', params: {} }])).toBeNull()
    expect(pickWeighted(seededRng(1), [])).toBeNull()
  })
})

describe('parseEncounterTable', () => {
  it('keeps valid entries and drops garbage', () => {
    const table = parseEncounterTable([
      { weight: 2, kind: 'combat', label: 'Wolves' },
      { weight: -1, kind: 'skill_challenge', label: 'Rockslide' },
      { kind: 'combat' },
      'nonsense',
    ] as never)
    expect(table).toHaveLength(2)
    expect(table[0]).toMatchObject({ kind: 'combat', label: 'Wolves', weight: 2 })
    expect(table[1].weight).toBe(1)
  })

  it('returns empty for non-arrays', () => {
    expect(parseEncounterTable(null)).toEqual([])
    expect(parseEncounterTable({} as never)).toEqual([])
  })
})

describe('fallbackEncounterTable', () => {
  it('always offers a usable weighted table', () => {
    const table = fallbackEncounterTable('the quay')
    expect(table.length).toBeGreaterThanOrEqual(2)
    expect(table.every((e) => e.weight > 0 && e.label)).toBe(true)
    expect(table[0].kind).toBe('skill_challenge')
  })
})
