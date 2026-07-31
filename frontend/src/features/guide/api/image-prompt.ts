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
import type { LocationRow } from '../types'

const SYSTEM_PROMPT = [
  'You rewrite an RPG location note into a short visual brief for a background painting.',
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
  'Answer with one sentence of 25-45 words. No preamble, no quotes, no list.',
].join('\n')

/**
 * Returns a people-free scene brief, or null when the model is unavailable or unhelpful - the
 * caller then uses the deterministic strip instead.
 */
export async function writeLocationScenePrompt(location: LocationRow, castNames: string[]): Promise<string | null> {
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
          max_tokens: 200,
        },
      }),
    })
    if (!res.ok) return null

    const json = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    const content = json.choices?.[0]?.message?.content?.trim()
    if (!content) return null

    // A model that answered with a paragraph, a refusal or a quote is not worth $0.015 of image.
    const cleaned = content.replace(/^["'\s]+|["'\s]+$/g, '').replace(/\s+/g, ' ')
    return cleaned.length >= 20 && cleaned.length <= 600 ? cleaned : null
  } catch {
    return null
  }
}
