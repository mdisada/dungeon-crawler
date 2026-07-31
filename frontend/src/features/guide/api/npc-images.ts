/**
 * An NPC's image set, built by the same chain a player character goes through (F02 SS4):
 *
 *   original -> base (backdrop keyed out) -> portrait + token
 *
 * The difference is who frames the crops. A player frames their own character by dragging a circle
 * over its head; a guide arrives with a whole cast and nobody to do that fourteen times, so the head
 * is measured from the cutout's own silhouette (crop-geometry.ts). The manual tool still overrides
 * any NPC the measurement gets wrong, and both paths derive the portrait identically.
 *
 * `portrait` is what the visual-novel speaker slot reads in play, and `token` is what the map and
 * the roster read - see session/social-staging.ts.
 */

import { env } from '@/config/env'
import {
  autoFrameFromSilhouette,
  composePrompt,
  cutOutBackdrop,
  DEFAULT_TOKEN_BACKGROUND,
  loadImage,
  renderCrop,
} from '@/features/image'
import { timeJob } from '@/lib/job-timer'
import { requestImage, toBlob, uploadAdventureMedia } from './images'
import { saveGuideImages } from './save-guide-row'
import type { Npc, NpcImages } from '../types'

const CLOUD_IMAGE_SIZE = 1024
const TOKEN_SIZE = 256
const PORTRAIT_W = 768
const PORTRAIT_H = 1024

/** What the model is asked to draw: the NPC's authored image prompt, or its description. */
export function npcImagePrompt(npc: Pick<Npc, 'imagePrompt' | 'description' | 'name'>): string {
  const subject = npc.imagePrompt.trim() || npc.description.trim() || npc.name
  return composePrompt('base_char', subject)
}

async function generateOriginal(adventureId: string, npc: Npc): Promise<Blob> {
  if (env.placeholderMedia) return toBlob('/placeholders/fullbody.png')
  const url = await requestImage(adventureId, {
    prompt: npcImagePrompt(npc),
    size: `${CLOUD_IMAGE_SIZE}x${CLOUD_IMAGE_SIZE}`,
    output_format: 'png',
  })
  return toBlob(url)
}

/**
 * Generates and post-processes one NPC, writing the paths onto the row. Never throws for a failed
 * cutout: an NPC with an `original` and no crops is still an NPC with a picture, and the panel
 * offers the manual tool for it. Generation failures do throw - there is nothing to keep.
 */
export async function generateNpcImages(adventureId: string, npc: Npc): Promise<NpcImages> {
  const { result: original } = await timeJob('generate-npc-image', () => generateOriginal(adventureId, npc))
  const dir = `npcs/${npc.id}`
  const images: NpcImages = {
    original: await uploadAdventureMedia(adventureId, `${dir}/original.png`, original),
  }

  try {
    const {
      result: { blob: base, image },
    } = await timeJob('cutout-npc-image', () => cutOutBackdrop(original))
    images.base = await uploadAdventureMedia(adventureId, `${dir}/base.png`, base)

    const framed = autoFrameFromSilhouette(image)
    if (framed) {
      const baseUrl = URL.createObjectURL(base)
      try {
        const img = await loadImage(baseUrl)
        const [token, portrait] = await Promise.all([
          renderCrop(img, framed.token, TOKEN_SIZE, TOKEN_SIZE, DEFAULT_TOKEN_BACKGROUND),
          renderCrop(img, framed.portrait, PORTRAIT_W, PORTRAIT_H),
        ])
        images.token = await uploadAdventureMedia(adventureId, `${dir}/token.png`, token)
        images.portrait = await uploadAdventureMedia(adventureId, `${dir}/portrait.png`, portrait)
        images.tokenBackground = DEFAULT_TOKEN_BACKGROUND
      } finally {
        URL.revokeObjectURL(baseUrl)
      }
    }
  } catch {
    // Keyable-backdrop failures and canvas failures land here alike. The original is already
    // stored and saved below, so the DM can cut it by hand or regenerate.
  }

  await saveGuideImages('npcs', npc.id, images)
  return images
}

/**
 * Whether the automatic pass should draw this NPC: nothing usable stored yet, and something to draw
 * from. The second half matters because "Add NPC" inserts a blank row - spending a generation on an
 * empty description would buy a picture of nobody.
 */
export function needsImages(npc: Npc): boolean {
  const hasSubject = npc.imagePrompt.trim().length > 0 || npc.description.trim().length > 0
  const { original, base, portrait, token, fullbody } = npc.images
  return hasSubject && !original && !base && !portrait && !token && !fullbody
}
