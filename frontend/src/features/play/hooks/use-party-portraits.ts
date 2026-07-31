import { useEffect, useState } from 'react'

import { fetchPartyPortraits, type PartyPortrait } from '../api/party-portraits'

/** Well under the hour a signed URL lasts, so an image never expires mid-session. */
const REFRESH_MS = 45 * 60 * 1000

const NONE: Record<string, PartyPortrait> = {}

/**
 * Signed portrait/token URLs for the party, keyed by character id.
 *
 * Refetches when the roster changes and on a slow tick that outpaces the signed-URL expiry - a
 * session outlives an hour often enough that a silently-broken party bar would be the normal case.
 * The result carries the roster it answered and staleness is derived rather than cleared in the
 * effect, the shape use-media-url uses (react-hooks/set-state-in-effect). A refresh keeps the
 * previous URLs on screen until the new ones land, so the bar never blinks.
 */
export function usePartyPortraits(characterIds: string[]): Record<string, PartyPortrait> {
  const key = [...characterIds].sort().join(',')
  const [tick, setTick] = useState(0)
  const [fetched, setFetched] = useState<{ key: string; portraits: Record<string, PartyPortrait> } | null>(null)

  useEffect(() => {
    const timer = setInterval(() => setTick((n) => n + 1), REFRESH_MS)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    if (!key) return
    let cancelled = false
    fetchPartyPortraits(key.split(','))
      .then((portraits) => {
        if (!cancelled) setFetched({ key, portraits })
      })
      .catch(() => {
        // A party bar of initials is a fine degraded state; nothing here is worth an error banner.
      })
    return () => {
      cancelled = true
    }
  }, [key, tick])

  return fetched?.key === key ? fetched.portraits : NONE
}
