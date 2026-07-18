import { useCallback, useEffect, useRef, useState } from 'react'

import { getGuide } from '../api/get-guide'
import { runPipeline } from '../api/pipeline'
import type { GuideData } from '../types'

const POLL_MS = 2500
// Unchanged pending jobs for this many polls -> nudge the runner (kick delivery is best-effort
// fire-and-forget on the server, so the client is the safety net). The nudge is a cheap no-op
// ('busy') while a stage's LLM call is genuinely in flight.
const STALL_POLLS = 4

type GuideState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; data: GuideData }

export function useGuide(adventureId: string | undefined) {
  const [state, setState] = useState<GuideState>({ status: 'loading' })
  const stallCounter = useRef(0)
  const lastJobsFingerprint = useRef('')

  const refresh = useCallback(async () => {
    if (!adventureId) return
    try {
      const data = await getGuide(adventureId)
      setState({ status: 'ready', data })
    } catch (err) {
      setState((prev) =>
        prev.status === 'ready' ? prev : { status: 'error', message: err instanceof Error ? err.message : 'Failed to load guide' },
      )
    }
  }, [adventureId])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const isGenerating =
    state.status === 'ready' &&
    (state.data.adventure.status === 'generating' ||
      state.data.jobs.some((j) => j.status === 'queued' || j.status === 'running'))

  useEffect(() => {
    if (!adventureId || !isGenerating) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const data = await getGuide(adventureId)
          setState({ status: 'ready', data })

          // Nudge on ANY unchanged pending state: queued-with-nothing-running means a lost
          // kick; running-but-frozen means a wall-clock-killed invocation - `run` is safe in
          // both cases (it returns 'busy' while a job is genuinely alive, and its stale check
          // requeues corpses).
          const fingerprint = data.jobs.map((j) => `${j.id}:${j.status}`).join('|')
          const hasPending = data.jobs.some((j) => j.status === 'queued' || j.status === 'running')
          if (hasPending && fingerprint === lastJobsFingerprint.current) {
            stallCounter.current += 1
            if (stallCounter.current >= STALL_POLLS) {
              stallCounter.current = 0
              runPipeline(adventureId).catch(() => undefined)
            }
          } else {
            stallCounter.current = 0
          }
          lastJobsFingerprint.current = fingerprint
        } catch {
          // transient poll failure - next tick retries
        }
      })()
    }, POLL_MS)
    return () => window.clearInterval(timer)
  }, [adventureId, isGenerating])

  return { state, refresh, isGenerating }
}
