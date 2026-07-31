import { describe, expect, it } from 'vitest'

import { combatStateFromEngine, turnOptions } from './to-scene.ts'
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

  it('carries the assigned map: its artwork, its fit, and the board the engine actually plays on', () => {
    // The renderer used to assume 32x32 and object-cover. The engine has always played on the
    // assigned map's authored grid, so those two disagreed for every map that was not 32x32.
    const sized = { ...engine, gridWidth: 20, gridHeight: 15 } as CombatEngineState
    const scene = combatStateFromEngine(sized, {
      locationId: 'loc-1', mapUrl: 'https://signed/crypt.png', mapFit: 'contain',
    })
    expect(scene).toMatchObject({
      mapUrl: 'https://signed/crypt.png', mapFit: 'contain', gridWidth: 20, gridHeight: 15,
    })
  })

  it('falls back to cover when the map row does not say how to fit', () => {
    expect(combatStateFromEngine(engine, { locationId: null, mapUrl: null }).mapFit).toBe('cover')
  })
})

const playable = {
  ...engine,
  status: 'active',
  combatants: [
    { ...engine.combatants[0], auto: false, speed: 6, conditions: ['prone'],
      attacks: [{ name: 'Longsword', kind: 'melee', toHit: 5, damage: { count: 1, sides: 8, bonus: 3 }, range: 1 }] },
    { ...engine.combatants[1], auto: true, attacks: [] },
  ],
} as unknown as CombatEngineState

describe('turnOptions', () => {
  it('offers the active player combatant its own attacks and nothing else', () => {
    const options = turnOptions(playable)
    expect(options?.tokenId).toBe('pc1')
    expect(options?.attacks).toEqual([
      { index: 0, name: 'Longsword', kind: 'melee', toHit: 5, damage: '1d8+3', range: 1, longRange: null },
    ])
  })

  it('is null on an AI turn - there is nothing for a client to pick', () => {
    // Enemy stat blocks must never be published (redaction, 2026-07-22), and an AI turn is
    // resolved server-side anyway.
    expect(turnOptions({ ...playable, turnIndex: 0 } as CombatEngineState)).toBeNull()
  })

  it('is null once the fight has ended', () => {
    expect(turnOptions({ ...playable, status: 'ended' } as CombatEngineState)).toBeNull()
  })

  it('offers Stand up only when the movement to pay for it is there', () => {
    expect(turnOptions(playable)).toMatchObject({ canStandUp: true, standCost: 3 })
    const spent = { ...playable, economy: { ...playable.economy, move: 2 } } as CombatEngineState
    expect(turnOptions(spent)).toMatchObject({ canStandUp: false, standCost: 3 })
  })

  it('rides along on the scene state, so the action bar needs no second read', () => {
    expect(combatStateFromEngine(playable, { locationId: null, mapUrl: null }).options?.tokenId).toBe('pc1')
  })
})
