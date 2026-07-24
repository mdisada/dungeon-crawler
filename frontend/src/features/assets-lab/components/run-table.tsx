import { formatDuration } from '@/lib/job-timer'
import type { LabRun } from '../types'
import { RunOutput } from './run-output'

interface Props {
  runs: LabRun[]
  onClear: () => void
}

export function RunTable({ runs, onClear }: Props) {
  if (runs.length === 0) {
    return <p className="text-sm text-muted-foreground">No runs yet. Generate something above.</p>
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Runs ({runs.length})</h2>
        <button type="button" onClick={onClear} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-collapse text-sm">
          <thead>
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="py-2 pr-3 font-medium">Route</th>
              <th className="py-2 pr-3 font-medium">Model</th>
              <th className="py-2 pr-3 font-medium">Variant</th>
              <th className="py-2 pr-3 font-medium">Input</th>
              <th className="py-2 pr-3 font-medium">First audio</th>
              <th className="py-2 pr-3 font-medium">Total</th>
              <th className="py-2 pr-3 font-medium">Cost</th>
              <th className="py-2 pr-3 font-medium">Output</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.id} className="border-b align-top">
                <td className="py-2 pr-3 whitespace-nowrap">{run.routeLabel}</td>
                <td className="py-2 pr-3 font-mono text-xs">{run.model}</td>
                <td className="py-2 pr-3 whitespace-nowrap">{run.variant}</td>
                <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">{run.input}</td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                  {run.firstAudioMs === null ? '-' : formatDuration(run.firstAudioMs)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums">
                  {run.error ? <span className="text-destructive">failed</span> : formatDuration(run.totalMs)}
                </td>
                <td className="py-2 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">
                  {run.costUsd === null ? '-' : `$${run.costUsd.toFixed(4)}`}
                </td>
                <td className="py-2 pr-3">
                  {run.error ? (
                    <span className="text-xs text-destructive">{run.error}</span>
                  ) : (
                    <RunOutput medium={run.medium} paths={run.outputPaths} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
