/**
 * Location background plates: the wide shot that sits behind narration and dialogue, visual-novel
 * style. Unlike a character image this is scenery only - no cutout, no crops, nothing to frame.
 *
 * Two rules shape the request, both from the fact that the plate is a BACKGROUND:
 *
 * - 16:9, because it fills the scene box behind text. Measured 2026-07-31: Krea honours
 *   `aspect_ratio` and ignores `size` (a 1344x768 `size` came back 1024x1024), so the ratio is
 *   requested the only way that works.
 * - Nobody in it. The cast is stripped from the prompt (location-prompt.ts) and the preset asks for
 *   an empty place, because who is present is decided by play, not painted into the wall.
 */

import { env } from '@/config/env'
import { composePrompt } from '@/features/image'
import { timeJob } from '@/lib/job-timer'
import { writeLocationScenePrompt } from './image-prompt'
import { requestImage, toBlob, uploadAdventureMedia } from './images'
import { saveGeneratedMedia } from './save-guide-row'
import { locationImageSubject } from '../location-prompt'
import type { LocationRow } from '../types'

/** How many superseded plates stay in `previous_background_urls` (F04 SS5.3). */
const KEPT_BACKGROUNDS = 3

const ASPECT_RATIO = '16:9'

/** The deterministic brief: names stripped, nothing rewritten. Also the fallback for the one below. */
export function locationBackgroundPrompt(location: LocationRow, castNames: string[]): string {
  const subject = locationImageSubject(location, castNames)
  return subject ? composePrompt('background', subject) : ''
}

/**
 * The brief actually sent: a model rewrites the note into a place with nobody in it, because a
 * clause like "where agents watch" survives name-stripping and paints twenty people into the plate
 * (measured 2026-07-31 - see image-prompt.ts). Falls back to the deterministic strip.
 */
async function backgroundPrompt(location: LocationRow, castNames: string[]): Promise<string> {
  const fallback = locationBackgroundPrompt(location, castNames)
  if (!fallback) return ''
  const { result: written } = await timeJob('write-location-image-prompt', () =>
    writeLocationScenePrompt(location, castNames),
  )
  return written ? composePrompt('background', written) : fallback
}

/**
 * Generates one background and points the location at it, keeping the last few plates so a DM can
 * fall back after a regeneration they dislike. Returns null when the row says nothing to draw.
 */
export async function generateLocationBackground(
  adventureId: string,
  location: LocationRow,
  castNames: string[],
): Promise<string | null> {
  const prompt = await backgroundPrompt(location, castNames)
  if (!prompt) return null

  const { result: blob } = await timeJob('generate-location-background', async () => {
    if (env.placeholderMedia) return toBlob('/placeholders/background.png')
    return toBlob(await requestImage(adventureId, { prompt, aspect_ratio: ASPECT_RATIO, output_format: 'png' }))
  })

  // Versioned filename: the previous plates must stay readable at their own paths.
  const path = await uploadAdventureMedia(
    adventureId,
    `locations/${location.id}/background-${Date.now()}.png`,
    blob,
  )
  const previous = location.backgroundPath
    ? [location.backgroundPath, ...location.previousBackgroundPaths].slice(0, KEPT_BACKGROUNDS)
    : location.previousBackgroundPaths

  await saveGeneratedMedia('locations', location.id, {
    background_url: path,
    previous_background_urls: previous,
  })
  return path
}

/** Whether the automatic pass should draw this location: nothing stored, and something to draw. */
export function needsBackground(location: LocationRow): boolean {
  const hasSubject = location.imagePrompt.trim().length > 0 || location.description.trim().length > 0
  return hasSubject && !location.backgroundPath
}
