import { useEffect, useState } from 'react'

import type { Playthrough, RowSeverity, Turn } from '../types'

const SEV_TEXT: Record<RowSeverity, string> = {
  info: 'text-foreground/90',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  issue: 'text-destructive',
}

function TurnCard({ turn, highlight }: { turn: Turn; highlight?: boolean }) {
  const [raw, setRaw] = useState(false)
  return (
    <div
      id={`turn-${turn.index}`}
      className={`scroll-mt-2 rounded-md border ${highlight ? 'ring-2 ring-amber-500' : ''} ${turn.issueCount > 0 ? 'border-amber-500/50' : ''}`}
    >
      <div className="flex items-baseline gap-2 border-b bg-muted/30 px-3 py-1.5">
        <span className="shrink-0 text-xs font-semibold">{turn.label}</span>
        {turn.player !== null && (
          <span className="min-w-0 truncate text-sm">
            <span className="text-muted-foreground">{turn.playerRoute ?? 'player'}: </span>
            &ldquo;{turn.player}&rdquo;
          </span>
        )}
        {turn.issueCount > 0 && <span className="shrink-0 text-xs text-amber-600 dark:text-amber-400">⚠️ {turn.issueCount}</span>}
        <button
          type="button"
          onClick={() => setRaw(!raw)}
          className="ml-auto shrink-0 rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground hover:bg-muted"
        >
          {raw ? 'cards' : 'raw'}
        </button>
      </div>
      {raw ? (
        <div className="flex flex-col gap-1 p-2 font-mono text-[11px]">
          {turn.raw.map((event) => (
            <details key={event.id} className="border-b pb-1 last:border-b-0">
              <summary className="cursor-pointer text-muted-foreground">{event.created_at.slice(11, 19)} · {event.type}</summary>
              <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all">{JSON.stringify(event.payload, null, 2)}</pre>
            </details>
          ))}
        </div>
      ) : (
        <ul className="flex flex-col gap-1 p-2">
          {turn.rows.length === 0 && <li className="text-xs text-muted-foreground">(nothing notable)</li>}
          {turn.rows.map((row) => (
            <li key={row.eventId} className={`flex gap-2 text-sm ${SEV_TEXT[row.severity]}`}>
              <span className="shrink-0" aria-hidden>{row.icon}</span>
              <span className="min-w-0">{row.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function LabPlaythrough({ playthrough, jumpTo }: { playthrough: Playthrough; jumpTo?: number | null }) {
  // A click from the Narration tab lands here; scroll the target turn into view once it's painted.
  useEffect(() => {
    if (jumpTo == null) return
    const el = document.getElementById(`turn-${jumpTo}`)
    if (el) requestAnimationFrame(() => el.scrollIntoView({ behavior: 'smooth', block: 'start' }))
  }, [jumpTo])

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-2">
      <div className="flex flex-col gap-3">
        {playthrough.turns.map((turn) => <TurnCard key={turn.index} turn={turn} highlight={turn.index === jumpTo} />)}
      </div>
    </div>
  )
}
