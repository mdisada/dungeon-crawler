import { Button } from '@/components/ui/button'
import type { GuideImagePassState } from '../hooks/use-guide-image-pass'

interface Props {
  state: GuideImagePassState
  pendingCount: number
  onStart: () => void
  onStop: () => void
  onRetry: () => void
}

/**
 * The batch art control: what is still missing, and a button to draw it. Nothing here runs on its
 * own - generations follow a click (2026-07-31), because a guide often reuses art it already has
 * and every image is paid for.
 */
export function GuideImagePassBanner({ state, pendingCount, onStart, onStop, onRetry }: Props) {
  const { status, total, completed, current, failures } = state
  const isFinished = status === 'done' || status === 'stopped'

  if (status === 'idle') {
    if (pendingCount === 0) return null
    return (
      <section className="flex flex-wrap items-center gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p>
          <span className="font-medium">
            {pendingCount} {pendingCount === 1 ? 'entry has' : 'entries have'} no art yet
          </span>{' '}
          <span className="text-muted-foreground">
            &mdash; portraits and backgrounds can be drawn one at a time on their own tabs, or all at once here.
          </span>
        </p>
        <Button size="sm" className="ml-auto" onClick={onStart}>
          Draw all {pendingCount}
        </Button>
      </section>
    )
  }

  if (status === 'done' && failures.length === 0) return null

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      {status === 'running' && (
        <>
          <p>
            <span className="font-medium">
              Drawing guide art ({completed}/{total})
            </span>{' '}
            <span className="text-muted-foreground">
              {current ? `— ${current.kind === 'npc' ? 'portrait of' : 'background for'} ${current.name}` : ''}
            </span>
          </p>
          <div
            className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="Guide art progress"
          >
            <div className="h-full bg-primary transition-[width]" style={{ width: `${(completed / total) * 100}%` }} />
          </div>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onStop}>
            Stop
          </Button>
        </>
      )}

      {isFinished && (
        <>
          <p>
            {status === 'stopped' && <span className="font-medium">Stopped. </span>}
            {failures.length > 0 ? (
              <span className="text-muted-foreground">
                {failures.length} image{failures.length === 1 ? '' : 's'} could not be drawn:{' '}
                {failures.map((f) => f.name).join(', ')}. The rest are done.
              </span>
            ) : (
              <span className="text-muted-foreground">
                {completed} of {total} images drawn.
              </span>
            )}
          </p>
          <Button variant="outline" size="sm" className="ml-auto" onClick={onRetry}>
            {status === 'stopped' ? 'Resume' : 'Try again'}
          </Button>
        </>
      )}
    </section>
  )
}
