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
  /**
   * `undefined` means nothing has been picked yet, and the page resolves it to the first available
   * voice. `null` means silence was chosen deliberately. The two have to be distinguishable, or
   * choosing "No voice" would be overwritten by the default on the next render.
   */
  voiceProfileId: string | null | undefined
  /** Re-synthesize instead of serving the cache, so a run measures synthesis. */
  force: boolean
  maxChars: number
  /** Matches play's default, so what the lab measures is what a session will do. */
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
  // 15s, not the 8s first guessed. Measured 2026-08-01 against the real function: a 195-char box -
  // a normal one - is playable 7.2s after the request on s2.1-pro and 8.2s on the free engine, so
  // an 8s deadline would have fired on ordinary lines and made the gate look broken. This is a
  // ceiling that should almost never be reached, not a target.
  deadlineMs: 15_000,
  holdFirstBox: true,
  maxInFlight: 3,
  // The lab runs free by default; play uses s2.1-pro. Same model, no TTFA guarantee - so a timing
  // number taken here is a lower bound on the paid engine, not a substitute for it.
  model: 's2.1-pro-free',
  voiceProfileId: undefined,
  force: true,
  maxChars: 240,
  unit: 'lead',
  stress: 'manual',
  readingCps: 18,
  volume: 0.9,
}
