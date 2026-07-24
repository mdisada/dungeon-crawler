import { getAssetUrl } from '@/lib/asset-storage'
import { synthesize } from './synthesize'
import { getVoiceClipUrl } from './voice-profiles'
import type { AssetRoute } from '@/features/image'
import type { VoiceProfile } from '../types'

const PREVIEW_LINE = 'The tide has stopped, traveler. Sit - there is a story you need to hear.'

export interface VoicePreview {
  url: string
  /** False means you are hearing the raw uploaded clip, not synthesized speech. */
  cloned: boolean
  /** Why cloning fell back, when it did. Surfaced rather than swallowed. */
  reason?: string
}

/**
 * Synthesizes a fixed sample line in a profile's voice (F04 §5.1).
 *
 * Falls back to playing the uploaded clip when synthesis fails, but reports *why* - the previous
 * version caught every error and silently played the raw clip, which made a broken cloning path
 * indistinguishable from a working one.
 */
export async function previewVoice(
  userId: string,
  profile: VoiceProfile,
  // Fish (the default cloud provider) clones an uploaded clip, so a profile preview goes through
  // the cloud route -- no local worker needed. Falls back to playing the raw clip on any failure
  // (e.g. the user's tts_model is still Voxtral, which can't clone).
  route: AssetRoute = 'openrouter',
): Promise<VoicePreview> {
  try {
    const result = await synthesize({
      userId,
      jobId: crypto.randomUUID(),
      route,
      text: PREVIEW_LINE,
      voice: { kind: 'profile', profile },
    })
    const first = result.chunks[0]
    if (!first) throw new Error('Synthesis returned no audio')
    return { url: first.startsWith('blob:') ? first : await getAssetUrl(first), cloned: true }
  } catch (err) {
    return {
      url: await getVoiceClipUrl(profile.storagePath),
      cloned: false,
      reason: err instanceof Error ? err.message : 'Synthesis failed',
    }
  }
}
