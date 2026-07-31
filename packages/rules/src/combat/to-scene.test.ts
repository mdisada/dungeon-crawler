import { describe, expect, it } from 'vitest'

import { combatStateFromEngine } from './to-scene.ts'
import type { CombatEngineState } from './types.ts'

const engine = {
  obstacles: [[1, 1]],
  combatants: [
    { id: 'pc1', name: 'Bram', side: 'party', kind: 'pc', refId: 'char-1', imageUrl: null,
      x: 2, y: 3, hp: { current: 7, max: 12, temp: 0 }, conditions: [], speed: 6 },
    { id: 'e1', name: 'Dredger', side: 'enemy', kind: 'npc', refId: null, imageUrl: null,
      x: 8, y: 8, hp: { current: 20, max: 20, temp: 0 }, conditions: ['prone'], speed: 5 },
  ],
  initiative: [{ id: 'e1', total: 19 }, { id: 'pc1', total: 12 }],
  round: 2,
  turnIndex: 1,
  economy: { action: true, bonus: true, move: 6 },
} as unknown as CombatEngineState

describe('combatStateFromEngine', () => {
  it('maps combatants onto scene tokens the battle map can render', () => {
    const scene = combatStateFromEngine(engine, { locationId: 'loc-1', mapUrl: null })
    expect(scene.tokens.map((t) => [t.name, t.x, t.y, t.allegiance])).toEqual([
      ['Bram', 2, 3, 'party'],
      ['Dredger', 8, 8, 'enemy'],
    ])
    expect(scene.round).toBe(2)
    expect(scene.obstacles).toEqual([[1, 1]])
  })

  it('reads the active token from initiative order, not array order', () => {
    // turnIndex indexes INITIATIVE, so the active combatant is the second-highest roller here.
    expect(combatStateFromEngine(engine, { locationId: null, mapUrl: null }).activeTokenId).toBe('pc1')
    expect(combatStateFromEngine(engine, { locationId: null, mapUrl: null }).initiative)
      .toEqual([{ tokenId: 'e1', roll: 19 }, { tokenId: 'pc1', roll: 12 }])
  })

  it('leaves every token AI-controlled unless told otherwise', () => {
    // battle-map.tsx gates drags on controller/controllerUserId, so this is what keeps the map
    // read-only until a combat action route exists to receive a player's input.
    const scene = combatStateFromEngine(engine, { locationId: null, mapUrl: null })
    expect(scene.tokens.every((t) => t.controller === 'ai' && t.controllerUserId === null)).toBe(true)
  })

  it('grants control only where a controller is supplied', () => {
    const scene = combatStateFromEngine(engine, {
      locationId: null, mapUrl: null,
      controllers: { pc1: { controller: 'player', userId: 'user-9' } },
    })
    expect(scene.tokens.find((t) => t.id === 'pc1')).toMatchObject({ controller: 'player', controllerUserId: 'user-9' })
    expect(scene.tokens.find((t) => t.id === 'e1')).toMatchObject({ controller: 'ai', controllerUserId: null })
  })

  it('survives an ad-hoc combatant with no row behind it', () => {
    const scene = combatStateFromEngine(engine, { locationId: null, mapUrl: null })
    expect(scene.tokens.find((t) => t.id === 'e1')?.refId).toBe('')
  })
})
