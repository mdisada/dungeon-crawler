import { useEffect, useState } from 'react'

import { listLocationMedia, type LocationMedia, type MediaKind } from '../api/location-media'

type State =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: LocationMedia[] }

/** Whatever the last finished fetch produced, tagged with the filter it answered. */
type Fetched = { key: string; items: LocationMedia[] } | { key: string; message: string }

/**
 * The reusable art shelf for one kind, narrowed by tag overlap.
 *
 * The result carries the filter it answered, and staleness is derived rather than cleared in the
 * effect - the same shape use-media-url uses, and the reason is the same
 * (react-hooks/set-state-in-effect).
 */
export function useLocationMedia(kind: MediaKind, tags: string[]): State {
  const [fetched, setFetched] = useState<Fetched | null>(null)
  const key = `${kind}:${tags.join(',')}`

  useEffect(() => {
    let cancelled = false
    const [forKind, joined] = [kind, tags.join(',')]
    listLocationMedia({ kind: forKind, tags: joined ? joined.split(',') : [] })
      .then((items) => {
        if (!cancelled) setFetched({ key: `${forKind}:${joined}`, items })
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setFetched({
            key: `${forKind}:${joined}`,
            message: err instanceof Error ? err.message : 'Could not load the library',
          })
        }
      })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the joined form of both deps
  }, [key])

  if (!fetched || fetched.key !== key) return { status: 'loading' }
  return 'items' in fetched ? { status: 'ready', items: fetched.items } : { status: 'error', message: fetched.message }
}
