import { describe, expect, it } from 'vitest'

import { artBlockers, artReadiness } from './art-readiness'
import type { LocationRow, Npc } from './types'

const npc = (overrides: Partial<Npc> = {}): Npc =>
  ({
    id: 'npc-1',
    name: 'Elder Maren',
    role: 'npc',
    personality: {},
    faction: '',
    voiceId: null,
    imagePrompt: 'a weathered elder',
    images: {},
    description: 'Keeps the village records.',
    statBlock: null,
    humanEdited: false,
    pendingRegen: null,
    ...overrides,
  }) as Npc

const location = (overrides: Partial<LocationRow> = {}): LocationRow => ({
  id: 'loc-1',
  chapterId: null,
  name: 'The Drowned Quarter',
  description: 'A flooded dockside district.',
  imagePrompt: 'half-sunken warehouses',
  backgroundPath: null,
  previousBackgroundPaths: [],
  map: null,
  humanEdited: false,
  pendingRegen: null,
  ...overrides,
})

const withMap = (path: string): LocationRow['map'] => ({
  imagePath: path,
  gridCols: 25,
  gridRows: 25,
  imageWidth: 1024,
  imageHeight: 1024,
  imageFit: 'fill',
  obstacles: [],
  spawns: { party: [], enemy: [] },
})

describe('artReadiness', () => {
  it('counts what is missing by kind', () => {
    const readiness = artReadiness({
      npcs: [npc(), npc({ id: 'npc-2', name: 'Brann', images: { portrait: 'npcs/2/portrait.png' } })],
      locations: [location(), location({ id: 'loc-2', backgroundPath: 'locations/2/background.png' })],
    })
    expect(readiness.npcsMissing).toBe(1)
    expect(readiness.backgroundsMissing).toBe(1)
    expect(readiness.mapsMissing).toBe(2)
  })

  it('treats a missing map as non-blocking', () => {
    // Most places never host a fight, and a map is the asset a DM most often brings from elsewhere.
    const readiness = artReadiness({
      npcs: [npc({ images: { portrait: 'p.png' } })],
      locations: [location({ backgroundPath: 'bg.png' })],
    })
    expect(readiness.mapsMissing).toBe(1)
    expect(readiness.blocking).toEqual([])
  })

  it('stops counting a location once it has a map', () => {
    const readiness = artReadiness({
      npcs: [],
      locations: [location({ backgroundPath: 'bg.png', map: withMap('locations/1/map.png') })],
    })
    expect(readiness.gaps).toEqual([])
  })

  it('ignores an NPC with nothing to draw from, the way the generator does', () => {
    // A blank "Add NPC" row must not hold the table shut over a picture of nobody.
    const readiness = artReadiness({ npcs: [npc({ imagePrompt: '', description: '' })], locations: [] })
    expect(readiness.npcsMissing).toBe(0)
  })
})

describe('artBlockers', () => {
  it('names what has to be drawn before the table opens', () => {
    const messages = artBlockers({
      npcs: [npc(), npc({ id: 'npc-2', name: 'Brann' })],
      locations: [location()],
    })
    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain('2 NPCs still need a portrait: Elder Maren, Brann')
    expect(messages[1]).toContain('1 location still needs a background: The Drowned Quarter')
  })

  it('says nothing when the art is done', () => {
    expect(
      artBlockers({
        npcs: [npc({ images: { portrait: 'p.png' } })],
        locations: [location({ backgroundPath: 'bg.png' })],
      }),
    ).toEqual([])
  })

  it('never blocks on a missing map', () => {
    expect(
      artBlockers({
        npcs: [],
        locations: [location({ backgroundPath: 'bg.png', map: null })],
      }),
    ).toEqual([])
  })
})
