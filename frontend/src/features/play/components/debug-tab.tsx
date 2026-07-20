import { RefreshCw } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import type { DebugEventRow, DebugStory, DebugUsageStep } from '../api/session'
import { useDebugUsage } from '../hooks/use-debug-usage'
import { usePlay } from '../hooks/use-play-context'

function formatMs(ms: number | null): string {
  if (ms === null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms}ms`
}

function formatCost(cost: number | string | null): string {
  if (cost === null) return '—'
  return `$${Number(cost).toFixed(4)}`
}

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString()

type TimelineItem = { at: string; call: DebugUsageStep } | { at: string; event: DebugEventRow }

/** Dev-only pipeline telemetry: agent calls (model, latency, cost, raw response) interleaved
 *  with event_log rows (intent routing, nudges, consistency blocks) in one timeline. */
export function DebugTab() {
  const { adventure } = usePlay()
  const [isLive, setIsLive] = useState(true)
  const { state, refresh } = useDebugUsage(adventure.id, isLive)

  if (state.status === 'loading') return <p className="text-sm text-muted-foreground">Loading usage…</p>
  if (state.status === 'error') return <p className="text-sm text-destructive">{state.message}</p>

  const { steps, events, story } = state
  const totalCost = steps.reduce((sum, s) => sum + Number(s.cost_usd ?? 0), 0)
  const totalMs = steps.reduce((sum, s) => sum + (s.latency_ms ?? 0), 0)
  const timeline: TimelineItem[] = [
    ...steps.map((call) => ({ at: call.created_at, call })),
    ...events.map((event) => ({ at: event.created_at, event })),
  ].sort((a, b) => b.at.localeCompare(a.at))

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {steps.length} calls · {formatCost(totalCost)} · {formatMs(totalMs)} total
        </p>
        <div className="flex items-center gap-1">
          <Button
            variant={isLive ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={isLive}
            onClick={() => setIsLive((prev) => !prev)}
          >
            <span className={cn('mr-1.5 size-2 rounded-full', isLive ? 'bg-emerald-500' : 'bg-muted-foreground/40')} />
            Live
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Refresh usage" onClick={refresh}>
            <RefreshCw className="size-4" />
          </Button>
        </div>
      </div>

      {story && <StoryPanel story={story} />}

      {timeline.length === 0 ? (
        <p className="text-muted-foreground">Nothing logged for this adventure yet.</p>
      ) : (
        <ol className="flex flex-col gap-1.5">
          {timeline.map((item) =>
            'call' in item ? (
              <DebugStepRow key={`c-${item.call.id}`} step={item.call} />
            ) : (
              <DebugEventLine key={`e-${item.event.id}`} event={item.event} />
            ),
          )}
        </ol>
      )}
    </div>
  )
}

function DebugStepRow({ step }: { step: DebugUsageStep }) {
  return (
    <li className="rounded border p-2 text-xs">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-semibold capitalize">{step.agent_role.replaceAll('_', ' ')}</span>
        <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(step.created_at)}</span>
      </div>
      <p className="truncate text-muted-foreground" title={step.model}>
        {step.model}
      </p>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 tabular-nums text-muted-foreground">
        <span className="text-foreground">{formatMs(step.latency_ms)}</span>
        <span>{formatCost(step.cost_usd)}</span>
        <span>
          {step.prompt_tokens ?? '?'} in / {step.completion_tokens ?? '?'} out
        </span>
        {step.kind !== 'text' && <span className="uppercase">{step.kind}</span>}
      </div>
      {/* Narrator output is already the visible narration - only other agents need the raw view. */}
      {step.response_text && step.agent_role !== 'narrator' && (
        <details className="mt-1">
          <summary className="cursor-pointer select-none text-muted-foreground hover:text-foreground">
            Response
          </summary>
          <pre className="mt-1 max-h-60 overflow-y-auto whitespace-pre-wrap rounded bg-muted p-2 font-mono text-[11px]">
            {step.response_text}
          </pre>
        </details>
      )}
    </li>
  )
}

function StoryPanel({ story }: { story: DebugStory }) {
  const facts = { ...story.flags, ...story.world }
  const factEntries = Object.entries(facts)
  return (
    <div className="rounded border bg-muted/40 p-2 text-xs">
      <p className="font-semibold">Story state</p>
      <p className="text-muted-foreground">
        {story.location ?? 'no location'} · {story.mode ?? '?'} · day {story.day ?? '?'}
      </p>
      <p>
        <span className="text-muted-foreground">Loop: </span>
        {story.loop ? `${story.loop.type} → beat "${story.loop.beat ?? 'none open'}"` : 'none active'}
        {story.off_loop_streak !== 0 && ` (off-loop streak ${story.off_loop_streak})`}
      </p>
      <p>
        <span className="text-muted-foreground">Objective: </span>
        {story.objective ?? 'none active'}
      </p>
      <p className="break-words">
        <span className="text-muted-foreground">Encounter: </span>
        {story.encounter ? (
          <>
            {String(story.encounter.kind ?? '?')} "{String(story.encounter.label ?? '')}"{' '}
            <span className="font-mono text-[11px]">
              {JSON.stringify({
                progress: story.encounter.progress ?? null,
                contributions: story.encounter.contributions ?? {},
              })}
            </span>
          </>
        ) : (
          'none open'
        )}
      </p>
      {story.loop?.exit_conditions != null && (
        <p className="break-words">
          <span className="text-muted-foreground">Beat exits when: </span>
          <span className="font-mono text-[11px]">{JSON.stringify(story.loop.exit_conditions)}</span>
        </p>
      )}
      <p className="break-words">
        <span className="text-muted-foreground">World facts: </span>
        {factEntries.length > 0 ? (
          <span className="font-mono text-[11px]">{JSON.stringify(facts)}</span>
        ) : (
          'none recorded - beat/objective predicates cannot fire yet'
        )}
      </p>
    </div>
  )
}

function eventSummary(payload: Record<string, unknown>): string {
  const tags = ['route', 'kind', 'resolved', 'skill', 'name', 'tag', 'trigger', 'proposed', 'effect', 'source', 'day', 'label', 'tier', 'status', 'entry', 'rung']
    .map((key) => payload[key])
    .filter((v): v is string | number => typeof v === 'string' || typeof v === 'number')
    .map(String)
  if (payload.escalation === true) tags.push('escalation')
  if (payload.placeholder === true) tags.push('placeholder')
  if (payload.victory === true) tags.push('victory')
  const text = typeof payload.text === 'string' ? payload.text : typeof payload.draft === 'string' ? payload.draft : ''
  return [tags.join(' · '), text && `"${text.slice(0, 90)}${text.length > 90 ? '…' : ''}"`]
    .filter(Boolean)
    .join(' — ')
}

function DebugEventLine({ event }: { event: DebugEventRow }) {
  const summary = eventSummary(event.payload)
  return (
    <li className="rounded border border-dashed px-2 py-1 text-[11px] text-muted-foreground">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium text-foreground/80">{event.type}</span>
        <span className="shrink-0 tabular-nums">{timeOf(event.created_at)}</span>
      </div>
      {summary && <p className="break-words">{summary}</p>}
    </li>
  )
}
