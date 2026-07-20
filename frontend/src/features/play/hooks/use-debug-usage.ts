import { useCallback, useEffect, useState } from 'react'

import { fetchDebugUsage } from '../api/session'
import type { DebugEventRow, DebugStory, DebugUsageStep } from '../api/session'

const LIVE_POLL_MS = 5_000

export type DebugUsageState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; steps: DebugUsageStep[]; events: DebugEventRow[]; story: DebugStory | null }

/** Debug-tab data: usage_log rows for the adventure; polls while `isLive` is on. */
export function useDebugUsage(adventureId: string, isLive: boolean) {
  const [state, setState] = useState<DebugUsageState>({ status: 'loading' })
  const [tick, setTick] = useState(0)
  const refresh = useCallback(() => setTick((prev) => prev + 1), [])

  useEffect(() => {
    let cancelled = false
    fetchDebugUsage(adventureId)
      .then(({ steps, events, story }) => {
        if (!cancelled) setState({ status: 'ready', steps, events: events ?? [], story: story ?? null })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to load usage' })
        }
      })
    return () => {
      cancelled = true
    }
  }, [adventureId, tick])

  useEffect(() => {
    if (!isLive) return
    const timer = setInterval(() => setTick((prev) => prev + 1), LIVE_POLL_MS)
    return () => clearInterval(timer)
  }, [isLive])

  return { state, refresh }
}
