import type { AssetJobMark } from '@/lib/asset-job'
import type { AssetRoute } from '@/features/image'

export type Medium = 'image' | 'tts'

/**
 * One row of the comparison table. Session-only by design: the lab answers "which of these is
 * faster right now", and persisting runs would mean a migration plus a fetch hook for data that
 * goes stale as soon as a model or a GPU driver changes.
 */
export interface LabRun {
  id: string
  medium: Medium
  route: AssetRoute
  /** Explicit model id, or the local worker's backend name. */
  model: string
  /** Preset key for images, voice name for TTS. */
  variant: string
  /** Input magnitude, since generation time scales with it: '1024x1024' or '412 chars'. */
  input: string
  totalMs: number
  /** First playable audio segment; null for images and for failed runs. */
  firstAudioMs: number | null
  marks: AssetJobMark[]
  outputPaths: string[]
  costUsd: number | null
  error: string | null
  startedAt: number
}
