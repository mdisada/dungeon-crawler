/**
 * What art the guide is still missing, and what of it blocks the table opening.
 *
 * The line is drawn at "will a player see a hole where a picture should be":
 *
 *   - An NPC without a portrait speaks from an empty frame in the visual-novel view, and every NPC
 *     can be pulled into a scene, so all of them block.
 *   - A location without a background leaves the scene box blank the moment the party walks in, so
 *     those block too.
 *   - A location without a battle MAP does not block. Most places never host a fight, maps are the
 *     one asset a DM most often reuses from elsewhere, and a fight can be run in the shared scene
 *     box without one.
 */

import { needsBackground } from './api/location-images'
import { needsImages } from './api/npc-images'
import type { GuideData, LocationRow, Npc } from './types'

export interface ArtGap {
  kind: 'npc' | 'background' | 'map'
  id: string
  name: string
  /** Blocking gaps are listed by name when the DM tries to open the table. */
  blocking: boolean
}

export interface ArtReadiness {
  gaps: ArtGap[]
  blocking: ArtGap[]
  npcsMissing: number
  backgroundsMissing: number
  mapsMissing: number
}

export function artReadiness({ npcs, locations }: { npcs: Npc[]; locations: LocationRow[] }): ArtReadiness {
  const gaps: ArtGap[] = [
    ...npcs
      .filter((npc: Npc) => needsImages(npc))
      .map((npc): ArtGap => ({ kind: 'npc', id: npc.id, name: npc.name, blocking: true })),
    ...locations
      .filter((location: LocationRow) => needsBackground(location))
      .map((location): ArtGap => ({ kind: 'background', id: location.id, name: location.name, blocking: true })),
    ...locations
      .filter((location: LocationRow) => !location.map?.imagePath)
      .map((location): ArtGap => ({ kind: 'map', id: location.id, name: location.name, blocking: false })),
  ]

  return {
    gaps,
    blocking: gaps.filter((gap) => gap.blocking),
    npcsMissing: gaps.filter((gap) => gap.kind === 'npc').length,
    backgroundsMissing: gaps.filter((gap) => gap.kind === 'background').length,
    mapsMissing: gaps.filter((gap) => gap.kind === 'map').length,
  }
}

/** One line per blocking gap, for the list the Start Adventure check already renders. */
export function artBlockers(data: Pick<GuideData, 'npcs' | 'locations'>): string[] {
  const { npcsMissing, backgroundsMissing, blocking } = artReadiness(data)
  const messages: string[] = []
  const plural = (count: number, noun: string) =>
    `${count} ${noun}${count === 1 ? '' : 's'} still need${count === 1 ? 's' : ''}`

  if (npcsMissing > 0) {
    const names = blocking.filter((gap) => gap.kind === 'npc').map((gap) => gap.name)
    messages.push(`${plural(npcsMissing, 'NPC')} a portrait: ${names.join(', ')}`)
  }
  if (backgroundsMissing > 0) {
    const names = blocking.filter((gap) => gap.kind === 'background').map((gap) => gap.name)
    messages.push(`${plural(backgroundsMissing, 'location')} a background: ${names.join(', ')}`)
  }
  return messages
}
