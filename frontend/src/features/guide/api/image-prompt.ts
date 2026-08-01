/**
 * Turns an authored location row into a brief for a background plate.
 *
 * Stripping names with a regex (location-prompt.ts) is not enough, and this was measured rather
 * than assumed: the phrase "where agents watch from the rope bridges" survives name removal, and
 * the resulting plate came back with twenty figures in it - four in the foreground - despite the
 * preset asking for an empty place. A clause about people beats a style instruction about no
 * people, and no blocklist reliably tells "merchant stalls" (scenery) from "merchants waiting"
 * (a scene).
 *
 * So a model rewrites it: strip the cast, keep the place. It runs on the primary seat because
 * nothing downstream catches a bad brief - the next step spends $0.015 painting whatever it says.
 * The call costs a fraction of the image it protects, and any failure falls back to the
 * deterministic strip, which is what the app did before this existed.
 */

import { callEdgeFunction } from '@/lib/edge-function'
import { locationImageSubject } from '../location-prompt'
import { LOCATION_TAGS, normalizeTags, tagsFromText, type LocationTag } from '../media-tags'
import type { LocationRow } from '../types'

const SYSTEM_PROMPT = [
  'You rewrite an RPG location note into a short visual brief for a background painting, and file it',
  'under the kind of place it is.',
  '',
  'The painting sits BEHIND the dialogue in a visual novel. Who is present is decided by play, so',
  'the plate must be a place, not a scene:',
  '- Describe only architecture, terrain, weather, light, materials, time of day, wear and season.',
  '- Remove every person, creature and named character, including implied ones ("where the guards',
  '  wait" -> describe the guardpost, empty). Keep evidence people exist: lit windows, moored boats,',
  '  market stalls, banners, tracks in snow.',
  '- One exception: if the place would be plainly dead without them, you may keep a distant,',
  '  faceless crowd as texture ("a distant crowd filling the market square").',
  '- Never use proper nouns, names, factions or titles. Never mention text, signs or lettering.',
  '- No camera or style words (no "cinematic", "painterly", "wide shot") - those are added later.',
  '',
  '',
  'Answer with JSON only: {"brief": "one sentence of 25-45 words", "tags": ["..."]}.',
  `Tags describe the kind of place, 1-3 of them, chosen ONLY from: ${LOCATION_TAGS.join(', ')}.`,
].join('\n')

export interface SceneBrief {
  brief: string
  /** What kind of place it is, for the reusable library (media-tags.ts). Possibly empty. */
  tags: LocationTag[]
}

/**
 * Returns a people-free scene brief and its tags, or null when the model is unavailable or
 * unhelpful - the caller then uses the deterministic strip instead.
 *
 * The tags ride along on this call rather than taking one of their own: the model is already reading
 * the location to write the brief, and classifying it costs nothing extra.
 */
export async function writeLocationScenePrompt(
  location: LocationRow,
  castNames: string[],
): Promise<SceneBrief | null> {
  const source = locationImageSubject(location, castNames)
  if (!source) return null

  try {
    const res = await callEdgeFunction('ai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'text',
        agent_role: 'image_prompter',
        stream: false,
        payload: {
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: source },
          ],
          // 200 until 2026-08-01, when this silently stopped working. The primary seat moved to
          // openai/gpt-5.6-luna on 2026-07-31, and that is a REASONING model: it spends the token
          // budget thinking before emitting any visible content, so every call came back
          // finish_reason "length" with content null and this function returned null. The caller
          // then used the deterministic strip - the exact outcome the comment at the top of this
          // file exists to prevent, and it had been happening on every location image since.
          // Measured on a real location: 200 -> empty, 1000 -> a clean brief with 282 reasoning
          // tokens. A ceiling, not a spend.
          max_tokens: 1000,
        },
      }),
    })
    if (!res.ok) return null

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content?.trim()
    if (!content) return null

    // Models like to wrap JSON in a fenced block; take the object and ignore the packaging.
    const objectText = /\{[\s\S]*\}/.exec(content)?.[0]
    if (!objectText) return null
    const parsed = JSON.parse(objectText) as { brief?: unknown; tags?: unknown }

    const brief = typeof parsed.brief === 'string' ? parsed.brief.replace(/\s+/g, ' ').trim() : ''
    // A model that answered with a paragraph, a refusal or an empty string is not worth an image.
    if (brief.length < 20 || brief.length > 600) return null

    const tags = normalizeTags(parsed.tags)
    return { brief, tags: tags.length > 0 ? tags : tagsFromText(`${location.name} ${location.description}`) }
  } catch {
    return null
  }
}
