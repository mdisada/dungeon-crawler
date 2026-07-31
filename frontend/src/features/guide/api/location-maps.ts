/**
 * Turns a location's background plate into a top-down battle map.
 *
 * The background IS the prompt: it goes to Nano Banana as the only reference, and the model redraws
 * that same place seen from above. Measured 2026-07-31 against the alternative of also handing it a
 * blank 32x32 lattice - the lattice pins the ruling to exactly 32 cells, but the map it draws is
 * flatter: roofs left on, buildings rotated off-axis. Reference-only produced the better art (roofs
 * cut away, interiors furnished) at the cost of the model choosing its own cell count, which is a
 * cost worth paying because the count can simply be read back off the image (grid-detect.ts).
 *
 * Nano Banana rather than the account default because references are the entire mechanism here, and
 * Krea accepts them and ignores them.
 */

import { env } from '@/config/env'
import { decodeImageData, REFERENCE_IMAGE_MODEL } from '@/features/image'
import { detectGrid, rowsFromAspect, suggestGrid } from '@/features/map-editor'
import { timeJob } from '@/lib/job-timer'
import { getAdventureMediaUrl, requestImage, toBlob, uploadAdventureMedia } from './images'
import { addToLocationMedia } from './location-media'
import { saveGeneratedMedia } from './save-guide-row'
import { tagsFromText } from '../media-tags'
import { DEFAULT_BATTLE_MAP } from '../types'
import type { BattleMap, LocationRow } from '../types'

const PROMPT =
  'Redraw the location in the reference image as a TOP-DOWN orthographic tactical battle map, seen ' +
  'straight down from above like a floor plan. Keep the same buildings, terrain and layout, but ' +
  'viewed from directly overhead, with roofs cut away so interiors are visible. Painted fantasy ' +
  'battle-map style, clear walkable floor and distinct obstacles, no characters, no text or labels.'

export interface GeneratedMap {
  map: BattleMap
  /** Null when the ruling was not legible and the grid fell back to a guess from the dimensions. */
  detectedGrid: { cols: number; rows: number; confidence: number } | null
}

/**
 * Reads the tile count off the finished map, falling back to the dimension-based guess. The DM can
 * still correct it in the editor - this only aims to be right often enough that they rarely need to.
 */
async function gridFor(blob: Blob): Promise<{ cols: number; rows: number; detected: GeneratedMap['detectedGrid'] }> {
  try {
    const image = await decodeImageData(blob)
    const detected = detectGrid(image)
    if (detected) return { cols: detected.cols, rows: detected.rows, detected }
    const guess = suggestGrid(image.width, image.height)
    return { cols: guess.cols, rows: guess.rows, detected: null }
  } catch {
    return { cols: DEFAULT_BATTLE_MAP.gridCols, rows: DEFAULT_BATTLE_MAP.gridRows, detected: null }
  }
}

/**
 * Generates the map and stores it on the location. Returns null when there is no background to work
 * from - the plate is the input, so a location without one has nothing to redraw.
 *
 * Obstacles and spawns are cleared: they were painted on the previous art at the previous grid, and
 * silently keeping them would leave blocked squares sitting on open floor.
 */
export async function generateLocationMap(
  adventureId: string,
  location: LocationRow,
): Promise<GeneratedMap | null> {
  if (!location.backgroundPath) return null

  const { result: blob } = await timeJob('generate-location-map', async () => {
    if (env.placeholderMedia) return toBlob('/placeholders/map.png')
    const backgroundUrl = await getAdventureMediaUrl(location.backgroundPath!)
    const url = await requestImage(
      adventureId,
      {
        prompt: PROMPT,
        aspect_ratio: '1:1',
        output_format: 'png',
        input_references: [{ type: 'image_url', image_url: { url: backgroundUrl } }],
      },
      REFERENCE_IMAGE_MODEL,
    )
    return toBlob(url)
  })

  const path = await uploadAdventureMedia(adventureId, `locations/${location.id}/map-${Date.now()}.png`, blob)
  const { cols, rows, detected } = await gridFor(blob)
  const image = await decodeImageData(blob).catch(() => null)

  const map: BattleMap = {
    ...DEFAULT_BATTLE_MAP,
    imagePath: path,
    imageWidth: image?.width ?? null,
    imageHeight: image?.height ?? null,
    gridCols: cols,
    // Square tiles: if the detector only spoke for one axis, the other follows the aspect.
    gridRows: detected ? rows : rowsFromAspect(cols, image?.width ?? 1, image?.height ?? 1),
  }

  await saveGeneratedMedia('locations', location.id, { map })
  // Same shelf as the backgrounds, with the grid the detector read - a reused map arrives with its
  // tile count already right.
  await addToLocationMedia({
    adventureId,
    name: location.name,
    kind: 'map',
    path,
    tags: tagsFromText(`${location.name} ${location.description} ${location.imagePrompt}`),
    gridCols: map.gridCols,
    gridRows: map.gridRows,
  })
  return { map, detectedGrid: detected }
}
