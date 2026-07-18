import { useEffect, useState } from 'react'

import { getWorkerStatus } from '../api/get-worker-status'
import type { WorkerStatusLevel } from '../types'
import { getWorkerStatusLevel } from '../worker-status-level'

const POLL_INTERVAL_MS = 15_000

export function useWorkerStatus(userId: string | null): WorkerStatusLevel | null {
  const [level, setLevel] = useState<WorkerStatusLevel | null>(null)

  useEffect(() => {
    if (!userId) return

    let cancelled = false

    const poll = () => {
      getWorkerStatus(userId)
        .then(({ lastHeartbeatAt }) => {
          if (!cancelled) setLevel(getWorkerStatusLevel(lastHeartbeatAt))
        })
        .catch(() => {
          if (!cancelled) setLevel('red')
        })
    }

    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [userId])

  return userId ? level : null
}
