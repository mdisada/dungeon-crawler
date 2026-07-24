import { describe, expect, it } from 'vitest'

import { deriveNpcStatBlock } from '../guide/npc-stats.ts'
import type { NpcStatBlock } from '../guide/npc-stats.ts'
import { seededRng } from '../play/rng.ts'
import type { PartyMemberInput } from './convert.ts'
import { DIFFICULTY_PRESETS } from './difficulty.ts'
import { activeCombatant, createCombat } from './engine.ts'
import { runAutoTurn } from './heuristic.ts'
import {
  bossNpcStateForOutcome, buildManifest, deriveResult, fightIsOver, manifestToSetup, resolveDifficulty,
} from './manifest.ts'
import type { BuildManifestInput, CombatManifest, ManifestMapInput } from './manifest.ts'
import type { Combatant, CombatEngineState, CombatEvent, CombatSide } from './types.ts'

const statBlock = (over: Parameters<typeof deriveNpcStatBlock>[0], role: 'npc' | 'boss' = 'npc'): NpcStatBlock =>
  deriveNpcStatBlock(over, role)

const member = (id: string, over: Partial<PartyMemberInput> = {}): PartyMemberInput => ({
  id, name: id, level: 3, abilities: { str: 16, dex: 14, con: 14 }, abilityBonuses: null, hpMax: 24, ...over,
})

const blankMap = (width = 20, height = 20): ManifestMapInput => ({
  mapId: null, obstacles: [], spawns: { party: [], enemy: [] }, gridWidth: width, gridHeight: height,
})

const baseInput = (over: Partial<BuildManifestInput> = {}): BuildManifestInput => ({
  encounterId: 'enc-1',
  enemies: [{ name: 'Goblin', cr: '1/4', count: 3 }],
  npcs: [],
  party: [member('pc-a')],
  map: blankMap(),
  baselinePreset: 'standard',
  ...over,
})

/** A minimal engine state for the pure result helpers (they read winner + combatants only). */
const fakeState = (winner: CombatSide | null, combatants: Array<Partial<Combatant> & { id: string; side: CombatSide }>): CombatEngineState =>
  ({
    status: winner ? 'ended' : 'active',
    winner,
    combatants: combatants.map((c) => ({ dead: false, conditions: [], kind: c.side === 'party' ? 'pc' : 'npc', ...c })),
  } as unknown as CombatEngineState)

describe('buildManifest', () => {
  it('expands spec.enemies x count with deterministic ids', () => {
    const m = buildManifest(baseInput())
    expect(m.enemies).toHaveLength(3)
    expect(m.enemies.map((e) => e.id)).toEqual(['e0', 'e1', 'e2'])
    expect(m.enemies.every((e) => e.name === 'Goblin')).toBe(true)
    expect(m.encounterId).toBe('enc-1')
  })

  it('joins an authored stat block by name and never free-invents it', () => {
    const raider = statBlock({ cr: '1/2', archetype: 'skirmisher', attack: 'Cutlass' })
    const m = buildManifest(baseInput({
      enemies: [{ name: 'Brine Raider', cr: '1/2', count: 2 }],
      npcs: [{ id: 'npc-1', name: 'Brine Raider', role: 'npc', statBlock: raider }],
    }))
    expect(m.enemies).toHaveLength(2)
    expect(m.enemies[0].refId).toBe('npc-1')
    expect(m.enemies[0].attacks[0].name).toBe('Cutlass')
    expect(m.warnings).toHaveLength(0)
  })

  it('falls back to an SRD fixture by name, keeping the authored name', () => {
    const m = buildManifest(baseInput({ enemies: [{ name: 'Orc', cr: '1/2', count: 1 }] }))
    expect(m.enemies[0].refId).toBe('orc')
    expect(m.enemies[0].name).toBe('Orc')
    expect(m.warnings).toHaveLength(0)
  })

  it('CR-derives an unknown enemy and records a warning (F09 SS12 fallback logging)', () => {
    const m = buildManifest(baseInput({ enemies: [{ name: 'Gloomtide Wraith', cr: '3', count: 1 }] }))
    expect(m.enemies[0].refId).toBeNull()
    expect(m.enemies[0].hpMax).toBeGreaterThan(0)
    expect(m.warnings.some((w) => w.includes('Gloomtide Wraith'))).toBe(true)
  })

  it('marks bossRef from an npcs role=boss row inside spec.enemies', () => {
    const boss = statBlock({ cr: '3', archetype: 'leader' }, 'boss')
    const m = buildManifest(baseInput({
      enemies: [{ name: 'Goblin', cr: '1/4', count: 2 }, { name: 'Warchief', cr: '3', count: 1 }],
      npcs: [{ id: 'boss-1', name: 'Warchief', role: 'boss', statBlock: boss }],
    }))
    const bossSetup = m.enemies.find((e) => e.id === m.bossRef)
    expect(bossSetup?.refId).toBe('boss-1')
    expect(m.enemies).toHaveLength(3)
  })

  it('adds an explicit boss authored only as an npcs row (not in spec.enemies) as its own combatant', () => {
    const boss = statBlock({ cr: '4', archetype: 'leader' }, 'boss')
    const m = buildManifest(baseInput({
      enemies: [{ name: 'Goblin', cr: '1/4', count: 2 }],
      npcs: [{ id: 'boss-1', name: 'Valerius', role: 'boss', statBlock: boss }],
      bossNpcId: 'boss-1',
    }))
    expect(m.enemies).toHaveLength(3)
    expect(m.enemies.find((e) => e.id === m.bossRef)?.refId).toBe('boss-1')
  })

  it('does NOT inject an unreferenced boss npc into a routine encounter', () => {
    const boss = statBlock({ cr: '4', archetype: 'leader' }, 'boss')
    const m = buildManifest(baseInput({
      enemies: [{ name: 'Goblin', cr: '1/4', count: 2 }],
      npcs: [{ id: 'boss-1', name: 'Valerius', role: 'boss', statBlock: boss }],
    }))
    expect(m.enemies).toHaveLength(2)
    expect(m.bossRef).toBeNull()
  })

  it('leaves bossRef null when no boss is authored', () => {
    expect(buildManifest(baseInput()).bossRef).toBeNull()
  })

  it('deploys each side on its spawn cells, then falls back without overlap', () => {
    const m = buildManifest(baseInput({
      party: [member('pc-a'), member('pc-b')],
      map: { mapId: 'map-1', obstacles: [[5, 5]], spawns: { party: [[1, 1], [1, 2]], enemy: [[10, 1]] }, gridWidth: 20, gridHeight: 20 },
    }))
    expect(m.party.map((p) => [p.x, p.y])).toEqual([[1, 1], [1, 2]])
    expect(m.enemies[0]).toMatchObject({ x: 10, y: 1 })
    // No two combatants share a square, and none sits on the obstacle.
    const cells = [...m.party, ...m.enemies].map((c) => `${c.x},${c.y}`)
    expect(new Set(cells).size).toBe(cells.length)
    expect(cells).not.toContain('5,5')
  })

  it('produces a manifest that createCombat accepts without throwing', () => {
    const m = buildManifest(baseInput({ party: [member('pc-a'), member('pc-b')] }))
    expect(() => createCombat(manifestToSetup(m), seededRng(1))).not.toThrow()
  })
})

describe('resolveDifficulty', () => {
  it('maps a preset name case-insensitively', () => {
    expect(resolveDifficulty('hard').name).toBe('Hard')
    expect(resolveDifficulty('DEADLY').name).toBe('Deadly')
  })

  it('defaults unknown/missing presets to Standard', () => {
    expect(resolveDifficulty(undefined).name).toBe('Standard')
    expect(resolveDifficulty('nonsense').name).toBe('Standard')
  })

  it('shifts up and down the ladder by intensity, clamped', () => {
    expect(resolveDifficulty('standard', 1).name).toBe('Hard')
    expect(resolveDifficulty('standard', 2).name).toBe('Deadly')
    expect(resolveDifficulty('standard', 99).name).toBe('Deadly')
    expect(resolveDifficulty('standard', -99).name).toBe('Story')
  })

  it('lets a difficultyOverride win over baseline x intensity', () => {
    const m = buildManifest(baseInput({ baselinePreset: 'story', difficultyOverride: DIFFICULTY_PRESETS[4] }))
    expect(m.difficulty.name).toBe('Deadly')
  })
})

describe('deriveResult', () => {
  const manifest = (bossRef: string | null): Pick<CombatManifest, 'bossRef'> => ({ bossRef })

  it('victory with no casualties is a full-tier win', () => {
    const state = fakeState('party', [
      { id: 'pc-a', side: 'party' },
      { id: 'e0', side: 'enemy', dead: true },
    ])
    expect(deriveResult(state, manifest(null))).toEqual({
      outcome: 'victory', tier: 'full', bossOutcome: 'none', casualties: { pcIds: [], npcIds: ['e0'] },
    })
  })

  it('victory with a downed PC is a partial-tier win', () => {
    const state = fakeState('party', [
      { id: 'pc-a', side: 'party', conditions: ['unconscious'] },
      { id: 'pc-b', side: 'party' },
      { id: 'e0', side: 'enemy', dead: true },
    ])
    const r = deriveResult(state, manifest(null))
    expect(r.tier).toBe('partial')
    expect(r.casualties.pcIds).toEqual(['pc-a'])
  })

  it('defeat maps to the failed tier (fail-forward)', () => {
    const state = fakeState('enemy', [
      { id: 'pc-a', side: 'party', conditions: ['unconscious'] },
      { id: 'e0', side: 'enemy' },
    ])
    expect(deriveResult(state, manifest(null)).tier).toBe('failed')
  })

  it('boss down ends the fight as a win even while minions still stand', () => {
    const state = fakeState(null, [
      { id: 'pc-a', side: 'party' },
      { id: 'boss', side: 'enemy', dead: true },
      { id: 'e1', side: 'enemy' },
    ])
    const r = deriveResult(state, manifest('boss'))
    expect(r.outcome).toBe('victory')
    expect(r.tier).toBe('full')
    expect(r.bossOutcome).toBe('killed')
  })

  it('a spared boss on victory never scores as a defeat ending (2026-07-24 regression guard)', () => {
    const state = fakeState('party', [
      { id: 'pc-a', side: 'party' },
      { id: 'boss', side: 'enemy' }, // alive - the party spared it
    ])
    const r = deriveResult(state, manifest('boss'), { bossOutcome: 'spared' })
    expect(r.outcome).toBe('victory')
    expect(['full', 'partial']).toContain(r.tier)
    expect(r.bossOutcome).toBe('spared')
    expect(bossNpcStateForOutcome('spared')).toBe('alive')
    expect(bossNpcStateForOutcome('killed')).toBe('dead')
    expect(bossNpcStateForOutcome('escaped')).toBe('absent')
    expect(bossNpcStateForOutcome('none')).toBeNull()
  })
})

describe('fightIsOver', () => {
  it('is true once the engine has ended', () => {
    expect(fightIsOver(fakeState('party', [{ id: 'pc-a', side: 'party' }]), null)).toBe(true)
  })

  it('is true when the marked boss is down, even mid-fight', () => {
    const state = fakeState(null, [
      { id: 'pc-a', side: 'party' },
      { id: 'boss', side: 'enemy', dead: true },
      { id: 'e1', side: 'enemy' },
    ])
    expect(fightIsOver(state, 'boss')).toBe(true)
    expect(fightIsOver(state, null)).toBe(false)
  })
})

describe('headless replay', () => {
  const runToEnd = (m: CombatManifest, seed: number): { state: CombatEngineState; events: CombatEvent[] } => {
    const rng = seededRng(seed)
    const first = createCombat(manifestToSetup(m), rng)
    let state = first.state
    const events = [...first.events]
    for (let i = 0; i < 1000 && !fightIsOver(state, m.bossRef); i++) {
      const result = runAutoTurn(state, rng)
      state = result.state
      events.push(...result.events)
      void activeCombatant // (kept in scope for parity with the Lab driver)
    }
    return { state, events }
  }

  it('replays a story encounter byte-identically from the same seed', () => {
    const boss = statBlock({ cr: '3', archetype: 'brute' }, 'boss')
    const input = baseInput({
      enemies: [{ name: 'Goblin', cr: '1/4', count: 2 }],
      npcs: [{ id: 'boss-1', name: 'Warchief', role: 'boss', statBlock: boss }],
      bossNpcId: 'boss-1',
      party: [member('pc-a'), member('pc-b', { name: 'pc-b' })],
      map: blankMap(24, 24),
    })
    expect(buildManifest(input).bossRef).not.toBeNull()
    const a = runToEnd(buildManifest(input), 99)
    const b = runToEnd(buildManifest(input), 99)
    expect(JSON.stringify(a.events)).toBe(JSON.stringify(b.events))
    expect(JSON.stringify(a.state)).toBe(JSON.stringify(b.state))
    expect(fightIsOver(a.state, buildManifest(input).bossRef)).toBe(true)

    const result = deriveResult(a.state, buildManifest(input))
    expect(['victory', 'defeat']).toContain(result.outcome)
    expect(['full', 'partial', 'failed']).toContain(result.tier)
  })
})
