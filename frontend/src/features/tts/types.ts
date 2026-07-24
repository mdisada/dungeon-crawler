import type { AssetJobMark, AssetStage } from '@/lib/asset-job'
import type { AssetRoute } from '@/features/image'

export interface VoiceProfile {
  id: string
  name: string
  storagePath: string
}

/**
 * A cloned voice sends the reference clip itself (a signed URL for OpenRouter, a Storage path
 * for the worker); a preset voice sends a bare id the engine already knows. Kokoro on CPU only
 * supports the latter, which is why the worker reports `cloning` in its capabilities.
 */
export type VoiceSelection =
  | { kind: 'profile'; profile: VoiceProfile }
  | { kind: 'preset'; voiceId: string }

export interface SynthesizeArgs {
  userId: string
  jobId: string
  route: AssetRoute
  text: string
  voice: VoiceSelection
  /** Allowlisted OpenRouter model; omitted falls back to user_settings.tts_model. */
  model?: string
  usePlaceholder?: boolean
  onProgress?: (stage: AssetStage) => void
}

export interface TtsResult {
  /**
   * Ordered audio segments as Storage paths. The local worker chunks narration (~200 chars per
   * Opus file) so playback can start before synthesis finishes; OpenRouter returns one mp3, so
   * cloud results always have exactly one entry.
   */
  chunks: string[]
  marks: AssetJobMark[]
}
