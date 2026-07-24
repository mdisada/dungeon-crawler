import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { LabComment, LabRunEvent } from '../types'

// Known phases get a color; unknown ones (from future runner changes) render neutrally.
const PHASE_COLOR: Record<string, string> = {
  setup: 'text-muted-foreground',
  guide: 'text-blue-600 dark:text-blue-400',
  play: 'text-emerald-700 dark:text-emerald-400',
  analysis: 'text-purple-700 dark:text-purple-400',
}

interface RunLogProps {
  events: LabRunEvent[]
  comments: LabComment[]
  onPinComment: (body: string, eventId: number | null) => Promise<void>
}

export function RunLog({ events, comments, onPinComment }: RunLogProps) {
  const [expandedId, setExpandedId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [isFollowing, setIsFollowing] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (isFollowing) bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events.length, isFollowing])

  const commentsFor = (eventId: number) => comments.filter((c) => c.event_id === eventId)
  const runComments = comments.filter((c) => c.event_id === null)

  async function submitComment(eventId: number | null) {
    if (!draft.trim()) return
    await onPinComment(draft, eventId)
    setDraft('')
  }

  if (events.length === 0) {
    return <p className="p-4 text-sm text-muted-foreground">No log entries yet. Queue a run and start the watcher.</p>
  }

  return (
    // min-h-0 + flex-1 (not h-full): lets this shrink correctly as a column sibling of the
    // optional error banner in adventure-lab-page, instead of measuring against the parent's
    // TOTAL height and overflowing past it.
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center justify-between px-1">
        <span className="text-xs text-muted-foreground">{events.length} entries</span>
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <input type="checkbox" checked={isFollowing} onChange={(e) => setIsFollowing(e.target.checked)} />
          Follow tail
        </label>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto rounded-md border font-mono text-xs">
        {events.map((event) => {
          const pinned = commentsFor(event.id)
          const isExpanded = expandedId === event.id
          return (
            <div key={event.id} className="border-b last:border-b-0">
              <button
                type="button"
                onClick={() => setExpandedId(isExpanded ? null : event.id)}
                className="flex w-full items-baseline gap-2 px-2 py-1 text-left hover:bg-muted/50"
              >
                <span className="shrink-0 text-muted-foreground">{event.created_at.slice(11, 19)}</span>
                <span className={`shrink-0 ${PHASE_COLOR[event.phase] ?? ''}`}>{event.phase}</span>
                <span className="shrink-0 font-semibold">{event.fn}</span>
                <span className="truncate text-muted-foreground">{event.label}</span>
                {event.duration_ms !== null && (
                  <span className="ml-auto shrink-0 text-muted-foreground">{event.duration_ms}ms</span>
                )}
                {pinned.length > 0 && <span className="shrink-0" aria-label={`${pinned.length} comments`}>📌{pinned.length}</span>}
              </button>
              {isExpanded && (
                <div className="flex flex-col gap-2 border-t bg-muted/30 p-2">
                  <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all">
                    {JSON.stringify(event.detail, null, 2)}
                  </pre>
                  {pinned.map((c) => (
                    <p key={c.id} className="rounded bg-amber-100 p-1.5 font-sans dark:bg-amber-950">📌 {c.body}</p>
                  ))}
                  <div className="flex gap-2">
                    <Textarea rows={2} value={draft} onChange={(e) => setDraft(e.target.value)}
                      placeholder="Pin a comment on this entry for Claude…" className="font-sans text-sm" />
                    <Button type="button" size="sm" onClick={() => void submitComment(event.id)}>Pin</Button>
                  </div>
                </div>
              )}
            </div>
          )
        })}
        <div ref={bottomRef} />
      </div>

      <div className="flex flex-col gap-1 rounded-md border p-2">
        {runComments.map((c) => (
          <p key={c.id} className="text-sm">📌 {c.body}</p>
        ))}
        <div className="flex gap-2">
          <Textarea rows={2} value={expandedId === null ? draft : ''} onChange={(e) => { setExpandedId(null); setDraft(e.target.value) }}
            placeholder="Run-level comment…" className="text-sm" />
          <Button type="button" size="sm" onClick={() => void submitComment(null)}>Pin</Button>
        </div>
      </div>
    </div>
  )
}
