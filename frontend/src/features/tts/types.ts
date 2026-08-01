import type { AssetJobMark, AssetStage } from '@/lib/asset-job'
import type { AssetRoute } from '@/features/image'
import type { NarrationState } from './narration-state'

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

/** How Fish is asked for one narration line. `null` adventureId means a TTS-lab run. */
export interface NarrateArgs {
  adventureId: string | null
  lineId: string
  npcId?: string | null
  /** One entry per reveal chunk, in order - exactly the text each box will show. */
  chunks: string[]
  model?: string
  /** Overrides the NPC -> narrator fallback chain. The lab picks a voice directly. */
  voiceProfileId?: string | null
  maxInFlight?: number
  /** Re-synthesizes rather than serving the cache, so a lab run measures synthesis. */
  force?: boolean
}

export interface NarrationPlan {
  lineId: string
  /** No voice assigned anywhere: this line is not spoken and the caller ungates immediately. */
  silent: boolean
  model: string
  voiceProfileId: string | null
  chunks: { index: number; status: 'cached' | 'claimed' | 'awaiting'; url: string | null }[]
}

export interface UseNarrationAudioArgs extends Omit<NarrateArgs, 'lineId'> {
  /** Realtime topic suffix: the adventure id, or `lab-{user id}`. Null disables the hook. */
  scope: string | null
  lineId: string | null
  /** False (muted, or narration volume at zero) ungates immediately and spends nothing. */
  enabled: boolean
  deadlineMs: number
  holdFirstBox: boolean
  volume: number
}

export interface NarrationAudio {
  state: NarrationState
  /** Leading chunks that will never change again - see settledCount. */
  settled: number
  /** The text box may render at all (false only while holding for chunk 1). */
  canReveal: boolean
  /** Whether the advance chevron may show after `visibleCount` chunks have been revealed. */
  canAdvance: (visibleCount: number) => boolean
  play: (index: number) => void
  /** Plays several clips back to back - one box maps to N clips when synthesis is per sentence. */
  playSequence: (indices: number[]) => void
  stop: () => void
  /** Autoplay was blocked; a user gesture through `unlock` is needed. */
  needsUnlock: boolean
  unlock: () => void
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
