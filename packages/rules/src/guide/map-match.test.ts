import { describe, expect, it } from 'vitest'

import { pickBattleMap, tagsForFiction } from './map-match.ts'
import type { MapCandidate } from './map-match.ts'

const map = (id: string, name: string, tags: string[] = []): MapCandidate => ({ id, name, tags })

describe('tagsForFiction', () => {
  it('reads tags out of the fiction, plural or not', () => {
    expect(tagsForFiction('An ambush among the tombs below the chapel')).toEqual(['crypt', 'temple'])
  })

  it('returns nothing for fiction that names no ground', () => {
    expect(tagsForFiction('The confrontation everyone has been dreading')).toEqual([])
  })
})

describe('pickBattleMap', () => {
  const library = [
    map('m-crypt', 'Sunken Crypt', ['crypt']),
    map('m-dungeon', 'Lower Vaults', ['dungeon']),
    map('m-tavern', 'The Bent Nail', ['tavern', 'interior']),
    map('m-forest', 'Blackpine Stand', ['forest']),
  ]

  it('prefers an exact tag match', () => {
    const match = pickBattleMap('Cult salvagers ambush the party in the tomb', library)
    expect(match).toEqual({ mapId: 'm-crypt', quality: 'tag', matchedTags: ['crypt'] })
  })

  it('falls back to the nearest tag when no map carries the exact one', () => {
    const match = pickBattleMap('A fight in the ossuary', [map('m-dungeon', 'Lower Vaults', ['dungeon'])])
    expect(match.mapId).toBe('m-dungeon')
    expect(match.quality).toBe('neighbour')
  })

  it('assigns nothing rather than a contradicting map', () => {
    const match = pickBattleMap('Boarding action across the ship deck', [map('m-tavern', 'The Bent Nail', ['tavern'])])
    expect(match).toEqual({ mapId: null, quality: 'none', matchedTags: [] })
  })

  it('assigns nothing when the fiction names no ground', () => {
    expect(pickBattleMap('The final confrontation', library).mapId).toBeNull()
  })

  it('reads an untagged map name as its tag', () => {
    const match = pickBattleMap('They are cornered in the cavern', [map('m-1', 'Drowned Cave')])
    expect(match).toEqual({ mapId: 'm-1', quality: 'tag', matchedTags: ['cave'] })
  })

  it('reads CamelCase map names, which is how the starter library is named', () => {
    const starters = [map('m-grave', 'OldGraveyardPublic'), map('m-mine', 'DesertMineEntrancePublic')]
    expect(pickBattleMap('An ambush among the tombs', starters).mapId).toBe('m-grave')
    expect(pickBattleMap('Deep in the mine shaft', starters).mapId).toBe('m-mine')
  })

  it('breaks ties on candidate order, so the caller controls preference', () => {
    const own = map('own', 'My Crypt', ['crypt'])
    const starter = map('starter', 'Starter Crypt', ['crypt'])
    expect(pickBattleMap('in the tomb', [own, starter]).mapId).toBe('own')
    expect(pickBattleMap('in the tomb', [starter, own]).mapId).toBe('starter')
  })

  it('scores more overlapping tags higher', () => {
    const single = map('single', 'Waystop', ['camp'])
    const both = map('both', 'Forest Camp', ['camp', 'forest'])
    expect(pickBattleMap('A raid on the tents at the edge of the wood', [single, both]).mapId).toBe('both')
  })
})
