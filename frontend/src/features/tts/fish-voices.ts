/**
 * Fish Audio is the default cloud TTS provider (2026-07-24). The model id selects the engine;
 * the voice is a `reference_id` (a Fish voice model). Unlike Voxtral, Fish clones from an
 * uploaded clip: `ai-proxy` registers the clip as a Fish model once and reuses its reference_id.
 *
 * These ids double as the routing signal -- `ai-proxy` sends a tts request to Fish iff the model
 * is one of these (see _shared/fish.ts). Keep the two lists in sync.
 */
export const FISH_MODELS = ['s1', 's2-pro', 's2.1-pro', 's2.1-pro-free'] as const

export type FishModel = (typeof FISH_MODELS)[number]

export const DEFAULT_FISH_MODEL: FishModel = 's1'

export function isFishModel(model: string): boolean {
  return (FISH_MODELS as readonly string[]).includes(model)
}
