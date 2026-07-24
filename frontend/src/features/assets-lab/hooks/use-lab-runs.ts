import { useState } from 'react'

import { fetchRunCost } from '../api/run-cost'
import type { LabRun } from '../types'

// ai-proxy only writes the usage_log row once OpenRouter's generation-stats endpoint returns a
// cost, which for TTS lags the audio by ~6-15s (the row 404s until then). Poll long enough to
// outlast that: ~36s.
const COST_POLL_ATTEMPTS = 12
const COST_POLL_INTERVAL_MS = 3_000

/** Session-only run log. Newest first, cleared on reload - see LabRun's note on why. */
export function useLabRuns() {
  const [runs, setRuns] = useState<LabRun[]>([])

  function record(run: LabRun) {
    setRuns((prev) => [run, ...prev])
    // Local runs cost nothing and never write usage_log, so there is nothing to look up.
    if (run.error || run.route === 'local') return

    // ai-proxy writes usage_log after the response has already been handed back, and the audio
    // endpoint needs a follow-up stats call before it knows the cost - so poll briefly rather
    // than blocking the row on a value that isn't there yet.
    const startedAtIso = new Date(run.startedAt).toISOString()
    void (async () => {
      for (let attempt = 0; attempt < COST_POLL_ATTEMPTS; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, COST_POLL_INTERVAL_MS))
        const costUsd = await fetchRunCost(run.medium, startedAtIso).catch(() => null)
        if (costUsd !== null) {
          setRuns((prev) => prev.map((r) => (r.id === run.id ? { ...r, costUsd } : r)))
          return
        }
      }
    })()
  }

  return { runs, record, clear: () => setRuns([]) }
}
