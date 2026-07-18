import { useEffect, useState } from 'react'

import { getAdventureMediaUrl } from '../api/images'

/** Resolves a private adventure-media storage path to a signed URL for rendering. */
export function useMediaUrl(path: string | null | undefined): string | null {
  const [resolved, setResolved] = useState<{ path: string; url: string } | null>(null)

  useEffect(() => {
    if (!path) return
    let cancelled = false
    getAdventureMediaUrl(path)
      .then((url) => {
        if (!cancelled) setResolved({ path, url })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [path])

  // Derive staleness instead of clearing state in the effect (react-hooks/set-state-in-effect).
  return path && resolved?.path === path ? resolved.url : null
}
