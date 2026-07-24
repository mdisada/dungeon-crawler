import { useEffect, useRef } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import type { CombatEvent } from '@rules/combat'

import { formatEvent } from '../log-format'

interface LogPanelProps {
  events: CombatEvent[]
  queueCount: number
  stepMode: boolean
  canExport: boolean
  nameOf: (id: string) => string
  onRevealNext: () => void
  onRevealAll: () => void
  onExport: () => void
}

export function LogPanel({
  events, queueCount, stepMode, canExport, nameOf, onRevealNext, onRevealAll, onExport,
}: LogPanelProps) {
  const scrollRef = useRef<HTMLOListElement>(null)

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [events.length])

  const lines = events
    .map((event) => ({ event, text: formatEvent(event, nameOf) }))
    .filter((l): l is { event: CombatEvent; text: string } => l.text !== null)

  return (
    <section className="flex h-full min-h-0 flex-col rounded-lg border border-border">
      <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
        <h2 className="text-sm font-semibold">Combat log</h2>
        <Button variant="outline" size="xs" disabled={!canExport} onClick={onExport}>
          Export JSON
        </Button>
      </div>
      <ol ref={scrollRef} aria-label="Combat events" className="min-h-0 flex-1 overflow-y-auto p-2 font-mono text-xs leading-5">
        {lines.length === 0 && <li className="text-muted-foreground">No events yet -- roll initiative to begin.</li>}
        {/* Append-only list: index keys are stable here. */}
        {lines.map((line, i) => (
          <li
            key={i}
            className={cn(
              line.event.kind === 'round_start' && 'pt-1 font-bold',
              line.event.kind === 'turn_start' && 'text-sky-500',
              line.event.kind === 'attack' && 'text-foreground',
              line.event.kind === 'down' && 'font-semibold text-destructive',
              line.event.kind === 'combat_end' && 'pt-1 font-bold text-emerald-500',
              (line.event.kind === 'edit' || line.event.kind === 'difficulty') && 'text-muted-foreground',
            )}
          >
            {line.text}
          </li>
        ))}
      </ol>
      {queueCount > 0 && (
        <div className="flex items-center gap-2 border-t border-border px-3 py-2">
          <Button size="sm" onClick={onRevealNext}>
            {stepMode ? `Roll (${queueCount} queued)` : `Next (${queueCount})`}
          </Button>
          <Button variant="outline" size="sm" onClick={onRevealAll}>
            Reveal all
          </Button>
        </div>
      )}
    </section>
  )
}
