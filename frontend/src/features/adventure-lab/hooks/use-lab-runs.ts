import { useCallback, useEffect, useState } from 'react'

import { cancelRun, createRun, listRuns } from '../api/lab-runs'
import type { LabRun, LabRunConfig } from '../types'

const POLL_INTERVAL_MS = 5000

export function useLabRuns(userId: string | null) {
  const [runs, setRuns] = useState<LabRun[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const poll = () => {
      listRuns()
        .then((rows) => { if (!cancelled) { setRuns(rows); setError(null) } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load runs') })
    }
    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [userId])

  const queueRun = useCallback(async (config: LabRunConfig) => {
    if (!userId) return null
    const run = await createRun(userId, config)
    setRuns((prev) => [run, ...prev])
    return run
  }, [userId])

  const cancel = useCallback(async (runId: string) => {
    await cancelRun(runId)
    setRuns((prev) => prev.map((r) => (
      r.id === runId && (r.status === 'queued' || r.status === 'running')
        ? { ...r, status: 'cancelled' }
        : r
    )))
  }, [])

  return { runs, error, queueRun, cancel }
}
