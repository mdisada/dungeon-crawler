import { useState } from 'react'

import { decideReview } from '../../api/session'
import type { ReviewDecision } from '../../api/session'
import { usePlay } from '../../hooks/use-play-context'
import { ReviewConsole } from './review-console'

/**
 * Self-contained mount for the gist console: renders whenever a review is pending, in every
 * scene mode (NPC replies in roleplay, narration beats anywhere).
 */
export function ReviewPanel() {
  const { adventure, state } = usePlay()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const review = state.dm?.pendingReview ?? null
  if (!review) return null

  const handleDecision = (decision: ReviewDecision) => {
    if (busy) return
    setBusy(true)
    setNotice(null)
    decideReview(adventure.id, review.id, decision)
      .catch((err: unknown) => setNotice(err instanceof Error ? err.message : 'Decision failed'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="flex flex-col gap-1">
      {notice && (
        <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">
          {notice}
        </p>
      )}
      <ReviewConsole review={review} busy={busy} onDecision={handleDecision} />
    </div>
  )
}
