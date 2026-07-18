import { useEffect, useState } from 'react'

import { getCharacterImageUrl } from '../api/upload-character-image'

function isDirectlyUsable(path: string): boolean {
  return path.startsWith('/') || path.startsWith('http') || path.startsWith('data:')
}

// Resolves a stored characters.images entry (a private-bucket Storage path) to a signed URL.
// Placeholder-mode paths (public assets under /placeholders) and any already-absolute URL are
// derived directly in render; only genuine Storage paths need the async round trip in the effect.
export function useCharacterImageUrl(path: string | undefined): string | undefined {
  const [resolved, setResolved] = useState<{ path: string; url: string } | undefined>(undefined)

  useEffect(() => {
    if (!path || isDirectlyUsable(path)) return
    let cancelled = false
    getCharacterImageUrl(path)
      .then((signedUrl) => {
        if (!cancelled) setResolved({ path, url: signedUrl })
      })
      .catch(() => {
        // leave resolved as-is; render falls through to undefined for this path
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return undefined
  if (isDirectlyUsable(path)) return path
  return resolved?.path === path ? resolved.url : undefined
}
