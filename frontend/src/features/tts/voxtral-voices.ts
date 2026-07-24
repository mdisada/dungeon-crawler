/**
 * Voxtral Mini TTS preset voice slugs for the OpenRouter route.
 *
 * OpenRouter's `/audio/speech` takes a preset voice *slug* (`{lang}_{name}_{style}`), NOT a
 * reference clip -- zero-shot cloning is a separate Mistral endpoint (`audio.voices.create`)
 * that OpenRouter does not proxy. So on the cloud route you pick a preset; cloning only happens
 * on the local Chatterbox route.
 *
 * These slugs are verified working against the live API (2026-07-24). Mistral ships ~20 presets
 * across en/fr/etc; the rest are discoverable in Mistral Studio and can be typed into the lab's
 * free-text voice field. Passing a URL or an unknown slug returns "Provider returned 404".
 */
export interface VoxtralVoice {
  slug: string
  label: string
}

export const VOXTRAL_VOICES: VoxtralVoice[] = [
  { slug: 'en_paul_neutral', label: 'Paul (EN) - neutral' },
  { slug: 'en_paul_happy', label: 'Paul (EN) - happy' },
  { slug: 'en_paul_sad', label: 'Paul (EN) - sad' },
  { slug: 'en_paul_angry', label: 'Paul (EN) - angry' },
  { slug: 'en_paul_excited', label: 'Paul (EN) - excited' },
  { slug: 'fr_marie_neutral', label: 'Marie (FR) - neutral' },
  { slug: 'fr_marie_happy', label: 'Marie (FR) - happy' },
  { slug: 'fr_marie_sad', label: 'Marie (FR) - sad' },
]

export const DEFAULT_VOXTRAL_VOICE = 'en_paul_neutral'
