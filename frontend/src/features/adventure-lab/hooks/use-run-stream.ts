import { useCallback, useEffect, useRef, useState } from 'react'

import { addComment, listComments, listEventsSince } from '../api/lab-runs'
import type { LabComment, LabRunEvent } from '../types'

const POLL_INTERVAL_MS = 2500

/** Live-tails one run: incremental event fetch by id, plus that run's pinned comments. */
export function useRunStream(userId: string | null, runId: string | null) {
  const [events, setEvents] = useState<LabRunEvent[]>([])
  const [comments, setComments] = useState<LabComment[]>([])
  const [streamRunId, setStreamRunId] = useState(runId)
  const lastIdRef = useRef(0)

  // Reset during render when the selected run changes (React's "adjusting state on prop
  // change" pattern) - an effect-body reset is a cascading-render lint error.
  if (streamRunId !== runId) {
    setStreamRunId(runId)
    setEvents([])
    setComments([])
  }

  useEffect(() => {
    if (!runId) return
    // The incremental cursor restarts with the subscription (refs must not be written in render).
    lastIdRef.current = 0
    let cancelled = false
    const poll = () => {
      listEventsSince(runId, lastIdRef.current)
        .then((rows) => {
          if (cancelled || rows.length === 0) return
          lastIdRef.current = rows[rows.length - 1].id
          setEvents((prev) => [...prev, ...rows])
        })
        .catch(() => {})
      listComments(runId)
        .then((rows) => { if (!cancelled) setComments(rows) })
        .catch(() => {})
    }
    poll()
    const interval = setInterval(poll, POLL_INTERVAL_MS)
    return () => { cancelled = true; clearInterval(interval) }
  }, [runId])

  const pinComment = useCallback(async (body: string, eventId: number | null) => {
    if (!userId || !runId || !body.trim()) return
    const comment = await addComment(userId, runId, body.trim(), eventId)
    setComments((prev) => [...prev, comment])
  }, [userId, runId])

  return { events, comments, pinComment }
}
