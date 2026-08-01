import type { NarrationChunkState } from '@/features/tts'
import { cn } from '@/lib/utils'
import type { LabChunking } from '../chunking'

interface ChunkTimelineProps {
  chunking: LabChunking
  chunks: NarrationChunkState[]
  /** ms from the request starting to each box appearing on screen, keyed by box index. */
  revealedAt: Record<number, number>
  settledUnits: number
  /** Cumulative server marks before the first Fish call - otherwise a blind spot in the timeline. */
  serverTimings: Record<string, number> | null
}

const STATUS_STYLES: Record<NarrationChunkState['status'], string> = {
  pending: 'bg-amber-500/20 text-amber-200',
  ready: 'bg-emerald-500/20 text-emerald-200',
  failed: 'bg-red-500/20 text-red-200',
  timeout: 'bg-red-500/20 text-red-200',
}

function ms(value: number | null): string {
  return value === null ? '-' : `${(value / 1000).toFixed(2)}s`
}

/**
 * Where every millisecond of a run went, per synthesis unit.
 *
 * `ready` is the number that decides the feel: it is when the gate for that unit could open, and
 * the gap between it and `shown` is how long the player sat waiting. `server` is Fish's own
 * synthesis time, so `ready - server` is everything else - queueing behind the fan-out cap, the
 * upload, signing, and the broadcast round trip.
 */
export function ChunkTimeline({
  chunking,
  chunks,
  revealedAt,
  settledUnits,
  serverTimings,
}: ChunkTimelineProps) {
  if (chunks.length === 0) return null

  const boxOf = new Map<number, number>()
  chunking.unitsFor.forEach((units, boxIndex) => units.forEach((unit) => boxOf.set(unit, boxIndex)))
  const slowest = Math.max(...chunks.map((chunk) => chunk.settledMs ?? 0), 1)

  return (
    <div className="overflow-x-auto rounded-lg border">
      {serverTimings && (
        <p className="border-b px-3 py-2 font-mono text-xs text-muted-foreground">
          before the first Fish call:{' '}
          {['auth', 'authorize', 'voice', 'bust', 'plan', 'total']
            .filter((phase) => serverTimings[phase] !== undefined)
            .map((phase) => `${phase} ${serverTimings[phase]}ms`)
            .join(' · ')}
        </p>
      )}
      <table className="w-full min-w-[46rem] text-left text-xs">
        <caption className="sr-only">Per-chunk narration synthesis timeline</caption>
        <thead className="bg-muted/50 text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">#</th>
            <th scope="col" className="px-3 py-2 font-medium">Box</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Ready</th>
            <th scope="col" className="px-3 py-2 font-medium">Server</th>
            <th scope="col" className="px-3 py-2 font-medium">Shown</th>
            <th scope="col" className="w-1/3 px-3 py-2 font-medium">Elapsed</th>
          </tr>
        </thead>
        <tbody>
          {chunks.map((chunk) => {
            const boxIndex = boxOf.get(chunk.index) ?? 0
            const isGate = chunk.index === settledUnits
            return (
              <tr key={chunk.index} className={cn('border-t', isGate && 'bg-amber-500/5')}>
                <td className="px-3 py-1.5 font-mono">{chunk.index}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{boxIndex}</td>
                <td className="px-3 py-1.5">
                  <span className={cn('rounded px-1.5 py-0.5', STATUS_STYLES[chunk.status])}>
                    {chunk.status}
                    {chunk.cached ? ' (cached)' : ''}
                  </span>
                </td>
                <td className="px-3 py-1.5 font-mono">{ms(chunk.settledMs)}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">{ms(chunk.serverMs)}</td>
                <td className="px-3 py-1.5 font-mono text-muted-foreground">
                  {ms(revealedAt[boxIndex] ?? null)}
                </td>
                <td className="px-3 py-1.5">
                  <div className="h-1.5 w-full rounded-full bg-muted">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        chunk.status === 'ready' ? 'bg-emerald-500' : 'bg-red-500',
                      )}
                      style={{ width: `${Math.min(100, ((chunk.settledMs ?? 0) / slowest) * 100)}%` }}
                    />
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
      {chunks.some((chunk) => chunk.error) && (
        <ul className="border-t px-3 py-2 text-xs text-destructive">
          {chunks
            .filter((chunk) => chunk.error)
            .map((chunk) => (
              <li key={chunk.index}>
                #{chunk.index}: {chunk.error}
              </li>
            ))}
        </ul>
      )}
    </div>
  )
}
