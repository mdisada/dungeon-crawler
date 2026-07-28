import { describe, expect, it } from 'vitest'

import { DIFFICULTY_PRESETS } from './difficulty.ts'
import { buildManifest } from './manifest.ts'
import type { BuildManifestInput, CombatManifest } from './manifest.ts'
import { runFight, simulate, sweepDifficulty } from './sim.ts'

const OPEN_FIELD: BuildManifestInput['map'] = {
  mapId: null,
  obstacles: [],
  spawns: { party: [], enemy: [] },
  gridWidth: 20,
  gridHeight: 20,
}

const member = (id: string, level: number) => ({
  id,
  name: id,
  level,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 },
  abilityBonuses: null,
  hpMax: 8 + (level - 1) * 6,
})

function fight(over: Partial<BuildManifestInput> = {}): CombatManifest {
  return buildManifest({
    encounterId: 'test-fight',
    enemies: [{ name: 'Goblin', cr: '1/4', count: 4 }],
    npcs: [],
    party: [member('p1', 3), member('p2', 3), member('p3', 3), member('p4', 3)],
    map: OPEN_FIELD,
    ...over,
  })
}

describe('runFight', () => {
  it('replays byte-identically from the same seed', () => {
    const manifest = fight()
    const a = runFight(manifest, 12345)
    const b = runFight(manifest, 12345)
    expect(a.state).toEqual(b.state)
    expect(a.result).toEqual(b.result)
    expect(a.rounds).toBe(b.rounds)
  })

  it('resolves a normal fight well inside the turn cap', () => {
    const outcome = runFight(fight(), 7)
    expect(outcome.stalled).toBe(false)
    expect(outcome.turns).toBeGreaterThan(0)
    expect(['victory', 'defeat']).toContain(outcome.result.outcome)
  })

  it('reports an unresolvable fight as stalled, not as a defeat', () => {
    // Both sides melee-only and walled apart: nobody can ever reach anybody.
    const wall = Array.from({ length: 20 }, (_, y): [number, number] => [10, y])
    const outcome = runFight(
      fight({
        map: { ...OPEN_FIELD, obstacles: wall, spawns: { party: [[0, 0]], enemy: [[19, 19]] } },
        enemies: [{ name: 'Zombie', cr: '1/4', count: 1 }],
        party: [member('p1', 3)],
      }),
      3,
      50,
    )
    expect(outcome.stalled).toBe(true)
  })
})

describe('simulate', () => {
  it('aggregates a seed sweep into rates and distributions', () => {
    const summary = simulate(fight(), { runs: 40, label: 'party of 4 vs 4 goblins' })
    expect(summary.runs).toBe(40)
    expect(summary.records).toHaveLength(40)
    expect(summary.errors).toEqual([])
    expect(summary.winRate).toBeGreaterThanOrEqual(0)
    expect(summary.winRate).toBeLessThanOrEqual(1)
    const { full, partial, failed } = summary.tierRates
    expect(full + partial + failed).toBeCloseTo(1, 6)
    expect(summary.rounds.min).toBeLessThanOrEqual(summary.rounds.max)
    expect(summary.partyHp.max).toBeLessThanOrEqual(1)
  })

  it('is deterministic across identical sweeps', () => {
    const manifest = fight()
    const a = simulate(manifest, { runs: 25 })
    const b = simulate(manifest, { runs: 25 })
    expect(a.records).toEqual(b.records)
  })

  it('records a broken manifest as an error instead of a silent zero win rate', () => {
    const broken = { ...fight(), party: [] }
    const summary = simulate(broken, { runs: 5 })
    expect(summary.errorRate).toBe(1)
    expect(summary.errors.length).toBeGreaterThan(0)
  })
})

describe('sweepDifficulty', () => {
  it('runs every preset over the same seeds so the comparison is paired', () => {
    const summaries = sweepDifficulty(fight(), DIFFICULTY_PRESETS, { runs: 30 })
    expect(summaries.map((s) => s.difficulty)).toEqual(DIFFICULTY_PRESETS.map((p) => p.name))
    for (const summary of summaries) {
      expect(summary.records.map((r) => r.seed)).toEqual(summaries[0].records.map((r) => r.seed))
    }
  })

  it('makes a fight strictly harder as the preset climbs the ladder', () => {
    const [story, , , , deadly] = sweepDifficulty(fight(), DIFFICULTY_PRESETS, { runs: 60 })
    expect(story.partyHp.mean).toBeGreaterThan(deadly.partyHp.mean)
  })
})
