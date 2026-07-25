import { useCallback, useEffect, useState } from 'react'

import { fetchLabEntries } from '../api/lab-inspect'
import { cancelRun, createRun } from '../api/lab-runs'
import type { LabEntry, LabRunConfig } from '../types'

const POLL_INTERVAL_MS = 5000

/** The unified sidebar list: lab test runs + real playthroughs, plus queue/cancel of test runs. */
export function useLabEntries(userId: string | null, scope: 'mine' | 'all') {
  const [entries, setEntries] = useState<LabEntry[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false
    const poll = () => {
      fetchLabEntries(scope)
        .then((res) => { if (!cancelled) { setEntries(res.runs ?? []); setError(null) } })
        .catch((err) => { if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load runs') })
    }
    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [userId, scope])

  // The new run appears (with its adventure once generated) on the next poll.
  const queueRun = useCallback(async (config: LabRunConfig): Promise<void> => {
    if (!userId) return
    await createRun(userId, config)
  }, [userId])

  const cancel = useCallback(async (runId: string) => {
    await cancelRun(runId)
    setEntries((prev) => prev.map((e) => (e.runId === runId ? { ...e, status: 'cancelled' } : e)))
  }, [])

  return { entries, error, queueRun, cancel }
}
