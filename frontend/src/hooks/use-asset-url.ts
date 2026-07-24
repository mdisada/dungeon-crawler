import { useEffect, useState } from 'react'

import { getAssetUrl } from '@/lib/asset-storage'

function isDirectlyUsable(path: string): boolean {
  return path.startsWith('/') || path.startsWith('http') || path.startsWith('data:')
}

/**
 * Resolves an `assets` bucket path to a signed URL. Shared by features/image and features/tts,
 * which both receive paths rather than URLs (see lib/asset-storage.ts). Placeholder-mode paths
 * under /placeholders and any already-absolute URL pass straight through.
 */
export function useAssetUrl(path: string | null | undefined): string | undefined {
  const [resolved, setResolved] = useState<{ path: string; url: string } | undefined>(undefined)

  useEffect(() => {
    if (!path || isDirectlyUsable(path)) return
    let cancelled = false
    getAssetUrl(path)
      .then((signedUrl) => {
        if (!cancelled) setResolved({ path, url: signedUrl })
      })
      .catch(() => {
        // Leave unresolved; the caller renders its empty state rather than a broken element.
      })
    return () => {
      cancelled = true
    }
  }, [path])

  if (!path) return undefined
  if (isDirectlyUsable(path)) return path
  return resolved?.path === path ? resolved.url : undefined
}
