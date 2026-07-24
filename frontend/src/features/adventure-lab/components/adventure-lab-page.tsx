import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { isAdventureLabUser } from '../debug'
import { useLabRuns } from '../hooks/use-lab-runs'
import { useRunStream } from '../hooks/use-run-stream'
import { RunForm } from './run-form'
import { RunLog } from './run-log'

const STATUS_COLOR: Record<string, string> = {
  queued: 'text-muted-foreground',
  running: 'text-emerald-600 dark:text-emerald-400',
  done: 'text-foreground',
  failed: 'text-destructive',
  cancelled: 'text-muted-foreground line-through',
}

export function AdventureLabPage() {
  const { session } = useSession()
  const email = session?.user.email ?? null
  const userId = session?.user.id ?? null
  const { runs, error, queueRun, cancel } = useLabRuns(userId)
  const [pickedId, setPickedId] = useState<string | null>(null)
  // Until the user picks a run, follow the active one - derived, not synced in an effect.
  const selectedId = pickedId ?? (runs.find((r) => r.status === 'running') ?? runs[0])?.id ?? null
  const { events, comments, pinComment } = useRunStream(userId, selectedId)

  if (!isAdventureLabUser(email)) {
    return <p className="p-8 text-muted-foreground">Not available.</p>
  }

  const selected = runs.find((r) => r.id === selectedId) ?? null

  // Full-bleed overlay (combat-lab precedent): escapes the shared <main> padding/footer flow
  // entirely, so this page's own height is exact - no viewport-height guessing, no page scroll.
  // Only the sidebar list and the log panel scroll internally.
  return (
    <div className="fixed inset-0 z-40 flex bg-background">
      <aside className="flex h-full w-96 shrink-0 flex-col gap-4 overflow-y-auto border-r p-4">
        <Link to="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          &larr; Exit lab
        </Link>
        <RunForm onQueue={async (config) => {
          const run = await queueRun(config)
          if (run) setPickedId(run.id)
        }} />
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-semibold">Runs</h2>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {runs.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
          {runs.map((run) => (
            <div key={run.id} className={`flex items-center gap-2 rounded-md border p-2 text-sm ${run.id === selectedId ? 'border-foreground' : ''}`}>
              <button type="button" onClick={() => setPickedId(run.id)} className="flex min-w-0 flex-1 flex-col text-left">
                <span className="truncate">
                  {run.config.plot?.title ?? (run.config.adventure_id ? 'Replay' : 'Run')} · {run.config.quality} · p{run.config.party_size}
                </span>
                <span className={`text-xs ${STATUS_COLOR[run.status] ?? ''}`}>
                  {run.status}{run.spent_usd > 0 ? ` · $${Number(run.spent_usd).toFixed(3)}` : ''} · {run.created_at.slice(5, 16).replace('T', ' ')}
                </span>
              </button>
              {(run.status === 'queued' || run.status === 'running') && (
                <Button type="button" size="sm" variant="outline" onClick={() => void cancel(run.id)}>
                  Cancel
                </Button>
              )}
            </div>
          ))}
        </div>
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4">
        {selected?.error && (
          <p className="rounded-md border border-destructive p-2 text-sm text-destructive">{selected.error}</p>
        )}
        <RunLog events={events} comments={comments} onPinComment={pinComment} />
      </div>
    </div>
  )
}
