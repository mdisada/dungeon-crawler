import { Check, Loader2, X } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress'
import { cn } from '@/lib/utils'
import { retryJob } from '../api/pipeline'
import { STAGE_LABELS, type Chapter, type GuideJob } from '../types'

interface PipelineProgressProps {
  jobs: GuideJob[]
  chapters: Chapter[]
  onChanged: () => void
}

type StageState = 'done' | 'running' | 'failed' | 'waiting'

function stageIcon(state: StageState) {
  if (state === 'done') return <Check className="size-4 text-emerald-500" />
  if (state === 'running') return <Loader2 className="size-4 animate-spin text-primary" />
  if (state === 'failed') return <X className="size-4 text-destructive" />
  return <span className="size-4 text-center text-muted-foreground">·</span>
}

/**
 * F04 SS2: the thing to watch while the guide builds. Every stage, where the queue has got to, and
 * what broke if anything did.
 *
 * The bar used to be a bare <Progress value={...}> with no Track or Indicator inside it, which is
 * an empty container in Base UI - so a build that takes minutes showed a heading, a step count and
 * nothing moving. The sheen matters for the same reason: stage 4 can hold one percentage for a
 * long while, and a bar that never moves reads as a hang.
 *
 * A failed stage pauses the queue and exposes a retry button, with partial results left editable
 * below - nothing is in flight to clobber them.
 */
export function PipelineProgress({ jobs, chapters, onChanged }: PipelineProgressProps) {
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (jobs.length === 0) return null

  const done = jobs.filter((j) => j.status === 'done').length
  const percent = Math.round((done / jobs.length) * 100)
  const isRunning = jobs.some((j) => j.status === 'running' || j.status === 'queued')
  const chapterTitle = (id: string | null) => (id ? chapters.find((c) => c.id === id)?.title || 'chapter' : null)

  const stages = [1, 2, 3, 4, 5, 6, 7, 8].filter((s) => jobs.some((j) => j.stage === s))
  const stageState = (stage: number): StageState => {
    const stageJobs = jobs.filter((j) => j.stage === stage)
    if (stageJobs.every((j) => j.status === 'done')) return 'done'
    if (stageJobs.some((j) => j.status === 'running')) return 'running'
    if (stageJobs.some((j) => j.status === 'failed')) return 'failed'
    return 'waiting'
  }

  // What the DM is waiting on right now: the stage with something in flight, or the next one up.
  const activeStage =
    stages.find((s) => stageState(s) === 'running') ?? stages.find((s) => stageState(s) === 'waiting') ?? null

  async function retry(jobId: string) {
    setBusyJobId(jobId)
    setError(null)
    try {
      await retryJob(jobId)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Retry failed')
    } finally {
      setBusyJobId(null)
    }
  }

  return (
    <section aria-label="Guide generation progress" className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="flex items-center gap-3">
        {isRunning && <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-primary" />}
        <h2 className="text-sm font-semibold">
          {isRunning ? 'Building the Adventure Guide' : 'Guide generation paused'}
        </h2>
        <span className="ml-auto shrink-0 text-sm tabular-nums text-muted-foreground">
          {done} of {jobs.length} steps
        </span>
      </div>

      <Progress value={percent}>
        <ProgressTrack className="relative h-2.5">
          <ProgressIndicator
            style={{ width: `${percent}%` }}
            className={cn('relative overflow-hidden', isRunning && 'progress-sheen')}
          />
        </ProgressTrack>
      </Progress>

      {isRunning && activeStage !== null && (
        <p className="text-sm text-muted-foreground">
          Stage {activeStage} of {stages.length}: {STAGE_LABELS[activeStage]}
          <span className="text-muted-foreground/70"> — this usually takes a few minutes.</span>
        </p>
      )}

      <ul className="flex flex-col gap-1 text-sm">
        {stages.map((stage) => {
          const state = stageState(stage)
          const stageJobs = jobs.filter((j) => j.stage === stage)
          const failed = stageJobs.filter((j) => j.status === 'failed')
          return (
            <li key={stage} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span aria-hidden className="flex size-4 items-center justify-center">
                  {stageIcon(state)}
                </span>
                <span className={cn(state === 'done' && 'text-muted-foreground', state === 'running' && 'font-medium')}>
                  Stage {stage}: {STAGE_LABELS[stage]}
                  {stageJobs.length > 1 &&
                    ` (${stageJobs.filter((j) => j.status === 'done').length}/${stageJobs.length} chapters)`}
                </span>
              </div>
              {failed.map((job) => (
                <div key={job.id} className="ml-6 flex flex-col gap-1 rounded-md border border-destructive/40 p-2">
                  <p className="text-xs text-destructive">
                    {chapterTitle(job.chapterId) ? `${chapterTitle(job.chapterId)}: ` : ''}
                    {job.error ?? 'Failed'}
                  </p>
                  <div>
                    <Button size="sm" variant="outline" disabled={busyJobId === job.id} onClick={() => void retry(job.id)}>
                      Retry stage
                    </Button>
                  </div>
                </div>
              ))}
            </li>
          )
        })}
      </ul>

      {error && <p className="text-sm text-destructive">{error}</p>}
    </section>
  )
}
