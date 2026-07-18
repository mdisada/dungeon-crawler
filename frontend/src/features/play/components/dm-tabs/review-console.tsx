import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { PendingReviewState } from '@rules/state'

import type { ReviewDecision } from '../../api/session'

interface ReviewConsoleProps {
  review: PendingReviewState
  busy: boolean
  onDecision: (decision: ReviewDecision) => void
}

/**
 * Gist console (Slices 2-3): candidates send on click (the gist expands server-side into the
 * full line/narration), or the DM steers with their own gist, regenerates the set, lets the AI
 * answer this one unsteered, or dismisses (nothing sent, table unlocks).
 */
export function ReviewConsole({ review, busy, onDecision }: ReviewConsoleProps) {
  const [ownGist, setOwnGist] = useState('')

  const handleSteer = () => {
    const gist = ownGist.trim()
    if (!gist) return
    onDecision({ choice: 'steer', gist })
    setOwnGist('')
  }

  // Slice 4: a rolled check awaiting the ruling - accept the die or overrule it.
  if (review.kind === 'check_ruling') {
    return (
      <section aria-label="Check ruling" className="rounded-md border border-primary/40 bg-primary/5 p-2">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Check ruling</h3>
        <p className="mt-1 text-sm">
          {review.actorName}&rsquo;s {review.skill}: {review.detail} &rarr;{' '}
          <span
            className={review.success ? 'font-semibold text-emerald-600 dark:text-emerald-400' : 'font-semibold text-destructive'}
          >
            {review.success ? 'success' : 'failure'}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" disabled={busy} onClick={() => onDecision({ choice: 'accept' })}>
            Accept {review.success ? 'success' : 'failure'}
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision({ choice: 'flip' })}>
            Rule {review.success ? 'failure' : 'success'} instead
          </Button>
        </div>
      </section>
    )
  }

  return (
    <section aria-label="Reply review" className="rounded-md border border-primary/40 bg-primary/5 p-2">
      {review.kind === 'npc_reply' ? (
        <>
          <h3 className="text-xs font-semibold uppercase text-muted-foreground">
            {review.npcName} replies to {review.utterance.actorName}
          </h3>
          <p className="mt-0.5 text-xs italic text-muted-foreground">&ldquo;{review.utterance.text}&rdquo;</p>
          {review.checkResult && (
            <p className="mt-0.5 text-xs">
              <span
                className={review.checkResult.success ? 'text-emerald-600 dark:text-emerald-400' : 'text-destructive'}
              >
                {review.checkResult.skill} {review.checkResult.success ? 'succeeded' : 'failed'}
              </span>
            </p>
          )}
        </>
      ) : (
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">{review.label}</h3>
      )}

      <ul className="mt-2 flex flex-col gap-1">
        {review.candidates.map((candidate) => (
          <li key={candidate.id}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onDecision({ choice: 'pick', candidate_id: candidate.id })}
              className="w-full rounded border bg-background px-2 py-1 text-left text-sm hover:bg-accent disabled:opacity-50"
            >
              {candidate.gist}
            </button>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-2">
        <Input
          value={ownGist}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setOwnGist(e.target.value)}
          onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
            if (e.key === 'Enter') handleSteer()
          }}
          placeholder="Or write your own gist…"
          aria-label="Your own gist"
          disabled={busy}
        />
        <Button size="sm" disabled={busy || !ownGist.trim()} onClick={handleSteer}>
          Send
        </Button>
      </div>

      <div className="mt-2 flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision({ choice: 'regenerate' })}>
          Regenerate
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onDecision({ choice: 'auto' })}>
          ⚡ AI answers this one
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onDecision({ choice: 'dismiss' })}>
          Dismiss
        </Button>
      </div>
    </section>
  )
}
