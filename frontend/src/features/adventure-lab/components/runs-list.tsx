import { Button } from '@/components/ui/button'

import type { LabEntry } from '../types'

const KIND_BADGE: Record<LabEntry['kind'], string> = {
  test: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  real: 'bg-purple-500/15 text-purple-600 dark:text-purple-400',
}

interface RunsListProps {
  entries: LabEntry[]
  error: string | null
  selectedAdv: string | null
  scope: 'mine' | 'all'
  onScopeChange: (scope: 'mine' | 'all') => void
  onPick: (adventureId: string) => void
  onCancel: (runId: string) => void
}

export function RunsList({ entries, error, selectedAdv, scope, onScopeChange, onPick, onCancel }: RunsListProps) {
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-center justify-end gap-1.5 text-xs text-muted-foreground">
        <input type="checkbox" checked={scope === 'all'} onChange={(e) => onScopeChange(e.target.checked ? 'all' : 'mine')} />
        all adventures
      </label>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {entries.length === 0 && <p className="text-sm text-muted-foreground">No runs yet.</p>}
      {entries.map((entry) => {
        const cancellable = entry.kind === 'test' && (entry.status === 'queued' || entry.status === 'running')
        return (
          <div
            key={entry.runId ?? entry.adventureId}
            className={`flex items-center gap-2 rounded-md border p-2 text-sm ${entry.adventureId === selectedAdv ? 'border-foreground' : ''}`}
          >
            <button
              type="button"
              disabled={!entry.adventureId}
              onClick={() => entry.adventureId && onPick(entry.adventureId)}
              className="flex min-w-0 flex-1 flex-col text-left disabled:opacity-50"
            >
              <span className="flex items-center gap-1.5">
                <span className={`shrink-0 rounded px-1 text-[10px] uppercase ${KIND_BADGE[entry.kind]}`}>{entry.kind}</span>
                <span className="truncate">{entry.title}</span>
              </span>
              <span className="text-xs text-muted-foreground">
                {entry.status}
                {entry.spentUsd > 0 ? ` · $${entry.spentUsd.toFixed(3)}` : ''}
                {entry.quality ? ` · ${entry.quality}` : ''}
                {' · '}
                {entry.createdAt.slice(5, 16).replace('T', ' ')}
              </span>
            </button>
            {cancellable && entry.runId && (
              <Button type="button" size="sm" variant="outline" onClick={() => onCancel(entry.runId!)}>
                Cancel
              </Button>
            )}
          </div>
        )
      })}
    </div>
  )
}
