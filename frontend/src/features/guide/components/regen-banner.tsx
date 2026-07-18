import { useState } from 'react'

import { computeFieldDiff } from '@rules/guide'

import { Button } from '@/components/ui/button'
import { acceptRegen, rejectRegen, type GuideTable } from '../api/save-guide-row'

interface RegenBannerProps {
  table: GuideTable
  rowId: string
  current: Record<string, unknown>
  pendingRegen: Record<string, unknown>
  onResolved: () => void
}

function renderValue(value: unknown): string {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 1) ?? ''
}

// F04 SS7: a regeneration against a human-edited row lands as a proposal; the DM sees the
// field-level diff and accepts or dismisses it - never a silent overwrite.
export function RegenBanner({ table, rowId, current, pendingRegen, onResolved }: RegenBannerProps) {
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const diffs = computeFieldDiff(current, pendingRegen)

  async function resolve(accept: boolean) {
    setIsBusy(true)
    setError(null)
    try {
      if (accept) await acceptRegen(table, rowId, pendingRegen)
      else await rejectRegen(table, rowId)
      onResolved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resolve proposal')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="rounded-md border border-amber-500/50 bg-amber-500/10 p-3 text-sm">
      <p className="font-medium">Regeneration proposal (you edited this row, so nothing was overwritten)</p>
      {diffs.length === 0 ? (
        <p className="mt-2 text-muted-foreground">The proposal matches the current content.</p>
      ) : (
        <ul className="mt-2 flex flex-col gap-2">
          {diffs.map((d) => (
            <li key={d.field}>
              <span className="font-mono text-xs text-muted-foreground">{d.field}</span>
              <div className="mt-1 grid gap-2 sm:grid-cols-2">
                <div className="rounded bg-destructive/10 p-2 whitespace-pre-wrap">{renderValue(d.before)}</div>
                <div className="rounded bg-emerald-500/10 p-2 whitespace-pre-wrap">{renderValue(d.after)}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-2 text-destructive">{error}</p>}
      <div className="mt-3 flex gap-2">
        <Button size="sm" disabled={isBusy} onClick={() => void resolve(true)}>
          Accept proposal
        </Button>
        <Button size="sm" variant="outline" disabled={isBusy} onClick={() => void resolve(false)}>
          Keep mine
        </Button>
      </div>
    </div>
  )
}
