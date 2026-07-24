import { useState } from 'react'

import type { AssetStage } from '@/lib/asset-job'
import { timeJob } from '@/lib/job-timer'
import { synthesize } from '../api/synthesize'
import type { SynthesizeArgs, TtsResult } from '../types'

type Status = 'idle' | 'running' | 'error'

export interface TtsRunOutcome extends TtsResult {
  jobId: string
  durationMs: number
  /** When the first playable segment landed - the number that matters for live narration. */
  firstAudioMs: number | null
}

export function useSynthesis() {
  const [status, setStatus] = useState<Status>('idle')
  const [stage, setStage] = useState<AssetStage | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(args: Omit<SynthesizeArgs, 'jobId' | 'onProgress'>): Promise<TtsRunOutcome | null> {
    setStatus('running')
    setStage(null)
    setError(null)
    try {
      const { result, timing } = await timeJob('synthesize', (jobId) =>
        synthesize({ ...args, jobId, onProgress: setStage }),
      )
      setStatus('idle')
      return {
        ...result,
        jobId: timing.jobId,
        durationMs: timing.durationMs,
        firstAudioMs: result.marks.find((mark) => mark.stage === 'chunk')?.atMs ?? null,
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Speech synthesis failed')
      setStatus('error')
      return null
    } finally {
      setStage(null)
    }
  }

  return { status, stage, error, isRunning: status === 'running', run }
}
