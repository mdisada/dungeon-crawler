import { Button } from '@/components/ui/button'
import type { NpcImagePassState } from '../hooks/use-npc-image-pass'

interface Props {
  state: NpcImagePassState
  onStop: () => void
  onRetry: () => void
}

/**
 * Says what the background image pass is doing, because it is spending money on the DM's behalf.
 * Silent while idle, and silent once everything succeeded - a finished job is not news.
 */
export function NpcImagePassBanner({ state, onStop, onRetry }: Props) {
  const { status, total, completed, currentName, failures } = state
  const isFinished = status === 'done' || status === 'stopped'
  if (status === 'idle' || (status === 'done' && failures.length === 0)) return null

  return (
    <section className="flex flex-wrap items-center gap-3 rounded-md border p-3 text-sm">
      {status === 'running' && (
        <>
          <p>
            <span className="font-medium">
              Drawing NPC portraits ({completed}/{total})
            </span>{' '}
            <span className="text-muted-foreground">{currentName ? `— ${currentName}` : ''}</span>
          </p>
          <div
            className="h-1.5 w-32 overflow-hidden rounded-full bg-muted"
            role="progressbar"
            aria-valuenow={completed}
            aria-valuemin={0}
            aria-valuemax={total}
            aria-label="NPC portrait progress"
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
                {failures.length} NPC{failures.length === 1 ? '' : 's'} could not be drawn:{' '}
                {failures.map((f) => f.name).join(', ')}. The rest are done.
              </span>
            ) : (
              <span className="text-muted-foreground">
                {completed} of {total} portraits drawn.
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
