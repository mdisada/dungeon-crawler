import { useState } from 'react'

import type { AssetStage } from '@/lib/asset-job'
import { timeJob } from '@/lib/job-timer'
import { editImage, generateImage } from '../api/generate-image'
import type { GenerateImageArgs, ImageResult } from '../types'

type Status = 'idle' | 'running' | 'error'

export interface ImageRunOutcome extends ImageResult {
  jobId: string
  durationMs: number
}

type GenerateInput = Omit<GenerateImageArgs, 'jobId' | 'onProgress'>
type EditInput = GenerateInput & { sourcePath: string; instruction: string }

/**
 * Owns one image generation at a time. Returns the Storage path plus the stage marks, so the
 * wizard (which only wants the image) and the lab (which wants the timings) share one hook.
 */
export function useImageGeneration() {
  const [status, setStatus] = useState<Status>('idle')
  const [stage, setStage] = useState<AssetStage | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function run(
    label: string,
    fn: (jobId: string) => Promise<ImageResult>,
  ): Promise<ImageRunOutcome | null> {
    setStatus('running')
    setStage(null)
    setError(null)
    try {
      const { result, timing } = await timeJob(label, fn)
      setStatus('idle')
      return { ...result, jobId: timing.jobId, durationMs: timing.durationMs }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
      setStatus('error')
      return null
    } finally {
      setStage(null)
    }
  }

  const generate = (args: GenerateInput) =>
    run('generate-image', (jobId) => generateImage({ ...args, jobId, onProgress: setStage }))

  const edit = ({ sourcePath, instruction, ...args }: EditInput) =>
    run('edit-image', (jobId) => editImage({ ...args, jobId, sourcePath, instruction, onProgress: setStage }))

  return { status, stage, error, isRunning: status === 'running', generate, edit }
}
