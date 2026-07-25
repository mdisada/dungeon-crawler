import { useState } from 'react'

import type { Issue, Playthrough, RowSeverity, Turn } from '../types'

const SEV_TEXT: Record<RowSeverity, string> = {
  info: 'text-foreground/90',
  good: 'text-emerald-600 dark:text-emerald-400',
  warn: 'text-amber-600 dark:text-amber-400',
  issue: 'text-destructive',
}

function jumpToTurn(index: number) {
  document.getElementById(`turn-${index}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

function IssuesPanel({ issues }: { issues: Issue[] }) {
  const [open, setOpen] = useState(true)
  if (issues.length === 0) {
    return (
      <div className="rounded-md border border-emerald-600/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
        No anomalies flagged.
      </div>
    )
  }
  return (
    <div className="rounded-md border border-amber-500/50">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-semibold">
        ⚠️ {issues.length} thing{issues.length === 1 ? '' : 's'} to check
        <span className="ml-auto text-xs font-normal text-muted-foreground">{open ? 'hide' : 'show'}</span>
      </button>
      {open && (
        <ul className="max-h-44 overflow-y-auto border-t">
          {issues.map((issue) => (
            <li key={issue.eventId}>
              <button
                type="button"
                onClick={() => jumpToTurn(issue.turnIndex)}
                className={`flex w-full gap-2 px-3 py-1 text-left text-xs hover:bg-muted/50 ${issue.severity === 'issue' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}
              >
                <span className="shrink-0 text-muted-foreground">turn {issue.turnIndex}</span>
                <span className="truncate">{issue.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function TurnCard({ turn }: { turn: Turn }) {
  const [raw, setRaw] = useState(false)
  return (
    <div id={`turn-${turn.index}`} className={`scroll-mt-2 rounded-md border ${turn.issueCount > 0 ? 'border-amber-500/50' : ''}`}>
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

export function LabPlaythrough({ playthrough }: { playthrough: Playthrough }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <IssuesPanel issues={playthrough.issues} />
      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-2">
        <div className="flex flex-col gap-3">
          {playthrough.turns.map((turn) => <TurnCard key={turn.index} turn={turn} />)}
        </div>
      </div>
    </div>
  )
}
