import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { retryJob } from '../api/pipeline'
import { STAGE_LABELS, type Chapter, type GuideJob } from '../types'

interface PipelineProgressProps {
  jobs: GuideJob[]
  chapters: Chapter[]
  onChanged: () => void
}

// F04 SS2: live stage progress while the pipeline runs; a failed stage pauses the queue and
// exposes a retry button, with partial results staying editable below.
export function PipelineProgress({ jobs, chapters, onChanged }: PipelineProgressProps) {
  const [busyJobId, setBusyJobId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  if (jobs.length === 0) return null
  const done = jobs.filter((j) => j.status === 'done').length
  const chapterTitle = (id: string | null) =>
    id ? chapters.find((c) => c.id === id)?.title || 'chapter' : null

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

  const stages = [1, 2, 3, 4, 5, 6, 7].filter((s) => jobs.some((j) => j.stage === s))

  return (
    <section aria-label="Guide generation progress" className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold">Generating the Adventure Guide</h2>
        <span className="text-sm text-muted-foreground">
          {done}/{jobs.length} steps
        </span>
      </div>
      <Progress value={(done / jobs.length) * 100} />
      <ul className="flex flex-col gap-1 text-sm">
        {stages.map((stage) => {
          const stageJobs = jobs.filter((j) => j.stage === stage)
          const failed = stageJobs.filter((j) => j.status === 'failed')
          const running = stageJobs.some((j) => j.status === 'running')
          const stageDone = stageJobs.every((j) => j.status === 'done')
          return (
            <li key={stage} className="flex flex-col gap-1">
              <div className="flex items-center gap-2">
                <span aria-hidden>{stageDone ? '✓' : running ? '…' : failed.length > 0 ? '✕' : '·'}</span>
                <span className={stageDone ? 'text-muted-foreground' : ''}>
                  Stage {stage}: {STAGE_LABELS[stage]}
                  {stageJobs.length > 1 && ` (${stageJobs.filter((j) => j.status === 'done').length}/${stageJobs.length} chapters)`}
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
