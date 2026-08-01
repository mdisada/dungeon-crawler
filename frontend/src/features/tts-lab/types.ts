import type { SynthesisUnit } from './chunking'

export type StressMode = 'manual' | 'reader' | 'impatient'

export interface LabSettings {
  /** Per-chunk deadline: how long the gate waits before releasing a box without its audio. */
  deadlineMs: number
  /** Whether the first box waits for its own audio so text and voice land together. */
  holdFirstBox: boolean
  /** Fish requests in flight after the first chunk. 1 is fully sequential. */
  maxInFlight: number
  model: string
  voiceProfileId: string | null
  /** Re-synthesize instead of serving the cache, so a run measures synthesis. */
  force: boolean
  maxChars: number
  unit: SynthesisUnit
  /**
   * manual    - you click, like a player
   * reader    - auto-advances at `readingCps` characters per second
   * impatient - clicks the instant the chevron appears, which is what finds the gate's edges
   */
  stress: StressMode
  readingCps: number
  volume: number
}

export const DEFAULT_LAB_SETTINGS: LabSettings = {
  deadlineMs: 8_000,
  holdFirstBox: true,
  maxInFlight: 3,
  // The lab runs free by default; play uses s2.1-pro. Same model, no TTFA guarantee - so a timing
  // number taken here is a lower bound on the paid engine, not a substitute for it.
  model: 's2.1-pro-free',
  voiceProfileId: null,
  force: true,
  maxChars: 240,
  unit: 'box',
  stress: 'manual',
  readingCps: 18,
  volume: 0.9,
}
