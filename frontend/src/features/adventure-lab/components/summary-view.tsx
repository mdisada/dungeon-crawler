import type { Playthrough } from '../types'

function Stat({ label, value, alert }: { label: string; value: string; alert?: boolean }) {
  return (
    <div className="rounded-md border p-3">
      <div className={`text-2xl font-semibold ${alert ? 'text-amber-600 dark:text-amber-400' : ''}`}>{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

interface SummaryViewProps {
  playthrough: Playthrough
  /** Jump to a Logs turn (switches to the Logs tab and scrolls there). */
  onPickTurn: (turnIndex: number) => void
}

/** The at-a-glance overview: run stats + the anomaly findings, each linking into the Logs. */
export function SummaryView({ playthrough, onPickTurn }: SummaryViewProps) {
  const { issues, guide } = playthrough
  const playerTurns = playthrough.turns.filter((t) => t.player !== null).length
  const problems = issues.filter((i) => i.severity === 'issue').length
  const warnings = issues.filter((i) => i.severity === 'warn').length

  return (
    <div className="min-h-0 flex-1 overflow-y-auto rounded-md border p-4">
      <div className="mx-auto flex max-w-3xl flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="player turns" value={String(playerTurns)} />
          <Stat label="objectives done" value={`${guide.counts.objectivesDone}/${guide.counts.objectivesTotal}`} />
          <Stat
            label="clues found"
            value={`${guide.counts.cluesFound}/${guide.counts.cluesTotal}`}
            alert={guide.counts.cluesTotal > 0 && guide.counts.cluesFound === 0}
          />
          <Stat label="things to check" value={String(issues.length)} alert={issues.length > 0} />
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold">
            Findings
            {issues.length > 0 && (
              <span className="ml-1 font-normal text-muted-foreground">
                · {problems} problem{problems === 1 ? '' : 's'}, {warnings} warning{warnings === 1 ? '' : 's'}
              </span>
            )}
          </h3>
          {issues.length === 0 ? (
            <p className="rounded-md border border-emerald-600/40 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-400">
              No anomalies flagged.
            </p>
          ) : (
            <ul className="flex flex-col divide-y rounded-md border">
              {issues.map((issue) => (
                <li key={issue.eventId}>
                  <button
                    type="button"
                    onClick={() => onPickTurn(issue.turnIndex)}
                    className={`flex w-full items-start gap-2 px-3 py-1.5 text-left text-sm hover:bg-muted/50 ${issue.severity === 'issue' ? 'text-destructive' : 'text-amber-600 dark:text-amber-400'}`}
                  >
                    <span className="shrink-0" aria-hidden>{issue.severity === 'issue' ? '🔴' : '⚠️'}</span>
                    <span className="min-w-0 flex-1">{issue.text}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">turn {issue.turnIndex} →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
