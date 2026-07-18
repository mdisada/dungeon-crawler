import { useEffect, useState } from 'react'

import { getAiCredit } from '../api/get-ai-credit'

const POLL_INTERVAL_MS = 60_000

/** Polls the ai-credit edge function (itself cached 60s server-side) for the navbar meter. */
export function useAiCredit() {
  const [creditUsd, setCreditUsd] = useState<number | null>(null)

  useEffect(() => {
    let cancelled = false

    const fetchCredit = () => {
      getAiCredit()
        .then((value) => {
          if (!cancelled) setCreditUsd(value)
        })
        .catch(() => {
          // Navbar meter degrades to "unknown" rather than surfacing an error toast.
        })
    }

    fetchCredit()
    const interval = setInterval(fetchCredit, POLL_INTERVAL_MS)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  return creditUsd
}
