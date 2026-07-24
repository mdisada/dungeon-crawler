import type { AssetJobMark, AssetStage } from '@/lib/asset-job'
import type { AssetRoute } from '@/features/image'

export interface VoiceProfile {
  id: string
  name: string
  storagePath: string
}

/**
 * How a voice is chosen for one synthesis:
 *   profile - clone an uploaded clip (Fish or local Chatterbox; not Voxtral)
 *   preset  - a bare id the engine knows (Voxtral slug, Fish reference_id, or worker preset)
 *   default - the provider's built-in voice (Fish default / worker narrator); no id sent
 */
export type VoiceSelection =
  | { kind: 'profile'; profile: VoiceProfile }
  | { kind: 'preset'; voiceId: string }
  | { kind: 'default' }

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
