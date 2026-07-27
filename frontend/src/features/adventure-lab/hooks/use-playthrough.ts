import { useEffect, useState } from 'react'

import { fetchPlaythrough } from '../api/lab-inspect'
import type { Playthrough } from '../types'

const LIVE_POLL_MS = 3000

interface Loaded {
  advId: string | null
  playthrough: Playthrough | null
  error: string | null
}

/** Loads one adventure's translated playthrough; polls while it is still being played (`live`). */
export function usePlaythrough(adventureId: string | null, live: boolean) {
  // One state object keyed by the adventure it belongs to, so switching runs clears stale data
  // without a synchronous setState in the effect body (all writes happen in the async callback).
  const [loaded, setLoaded] = useState<Loaded>({ advId: null, playthrough: null, error: null })

  useEffect(() => {
    if (!adventureId) return
    let cancelled = false
    const poll = () => {
      fetchPlaythrough(adventureId)
        .then((pt) => { if (!cancelled) setLoaded({ advId: adventureId, playthrough: pt, error: null }) })
        .catch((err) => {
          if (!cancelled) setLoaded({ advId: adventureId, playthrough: null, error: err instanceof Error ? err.message : 'Failed to load playthrough' })
        })
    }
    poll()
    const interval = live ? setInterval(poll, LIVE_POLL_MS) : null
    return () => { cancelled = true; if (interval) clearInterval(interval) }
  }, [adventureId, live])

  const ready = loaded.advId === adventureId
  return {
    playthrough: ready ? loaded.playthrough : null,
    loading: Boolean(adventureId) && !ready,
    error: ready ? loaded.error : null,
  }
}
