import { describe, expect, it } from 'vitest'

import { buildDemoScript } from './demo-script.ts'
import type { DemoContext } from './demo-script.ts'
import { applyDiffs } from './diff.ts'
import { hashState } from './hash.ts'
import { initialGameState } from './types.ts'
import type { GameState, Json } from './types.ts'

const ctx: DemoContext = {
  locationId: 'loc-1',
  locationName: 'Hollowbrook',
  backgroundUrl: 'bg.png',
  mapUrl: 'map.png',
  obstacles: [[3, 3]],
  npcs: [
    { id: 'n1', name: 'Elder Maren', imageUrl: null },
    { id: 'n2', name: 'The Stranger', imageUrl: null },
  ],
  objectives: [
    { id: 'o1', title: 'Find the missing boy' },
    { id: 'o2', title: 'Learn what the stranger wants' },
  ],
  party: [
    { userId: 'u1', characterId: 'c1', name: 'Ash', imageUrl: null },
    { userId: 'u2', characterId: 'c2', name: 'Bryn', imageUrl: null },
  ],
}

function walk(steps = buildDemoScript(ctx)): GameState[] {
  const states: GameState[] = []
  let state = initialGameState()
  for (const step of steps) {
    state = applyDiffs(state, step.diffs)
    states.push(state)
  }
  return states
}

describe('demo script', () => {
  it('walks narration -> roleplay -> battle -> narration -> downtime', () => {
    const modes = walk().map((s) => s.scene.mode)
    expect(modes[0]).toBe('narration')
    expect(modes).toContain('roleplay')
    expect(modes).toContain('battle')
    expect(modes[modes.length - 1]).toBe('downtime')
  })

  it('battle step activates the map, spawns tokens for the whole party, and sets initiative', () => {
    const battle = walk().find((s) => s.scene.mode === 'battle')
    expect(battle).toBeDefined()
    expect(battle!.scene.activeVisual).toBe('map')
    const combat = battle!.combat!
    expect(combat.tokens.filter((t) => t.kind === 'pc')).toHaveLength(2)
    expect(combat.tokens.filter((t) => t.allegiance === 'enemy').length).toBeGreaterThan(0)
    expect(combat.initiative[0].tokenId).toBe(combat.activeTokenId)
    expect(combat.obstacles).toEqual([[3, 3]])
  })

  it('battle end clears combat and returns the background (background XOR map)', () => {
    const states = walk()
    const battleIdx = states.findIndex((s) => s.scene.mode === 'battle')
    const after = states.slice(battleIdx).find((s) => s.scene.mode !== 'battle')!
    expect(after.combat).toBeNull()
    expect(after.scene.activeVisual).toBe('background')
  })

  it('objectives progress from active to completed over the script', () => {
    const last = walk().at(-1)!
    const o1 = last.objectives.list.find((o) => o.id === 'o1')
    expect(o1?.state).toBe('completed')
  })

  it('is deterministic for a fixed context (multi-client hash equality)', () => {
    const a = walk().at(-1)!
    const b = walk().at(-1)!
    expect(hashState(a as unknown as Json)).toBe(hashState(b as unknown as Json))
  })

  it('every diff domain is a known GameState domain', () => {
    const domains = new Set(buildDemoScript(ctx).flatMap((s) => s.diffs.map((d) => d.domain)))
    for (const d of domains) {
      expect(['scene', 'dialogue', 'combat', 'players', 'objectives', 'session', 'dm']).toContain(d)
    }
  })
})
