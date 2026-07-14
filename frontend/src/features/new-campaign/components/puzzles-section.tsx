import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { PuzzleCompilerPanel } from '@/features/puzzles'
import type { useCampaignManager } from '../hooks/use-campaign-manager'

type Props = {
  manager: ReturnType<typeof useCampaignManager>
  busy: boolean
}

export function PuzzlesSection({ manager, busy }: Props) {
  const {
    setup,
    plotPoints,
    puzzles,
    isDetectingPuzzles,
    detectSuggestedPuzzles,
    addPuzzle,
    removePuzzle,
  } = manager
  const [adding, setAdding] = useState(false)

  if (!plotPoints) return null

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-medium">Puzzles</h3>
          <p className="text-xs text-muted-foreground">
            Puzzles are authored here, up front — the DM only starts them during play.
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy || isDetectingPuzzles}
          onClick={() => detectSuggestedPuzzles()}
        >
          {isDetectingPuzzles ? 'Scanning plot…' : 'Re-scan plot for puzzles'}
        </Button>
      </div>

      {puzzles.length > 0 && (
        <div className="flex flex-col gap-2">
          {puzzles.map((puzzle) => (
            <div
              key={puzzle.localId}
              className="flex items-center justify-between rounded-md border border-border bg-card p-3"
            >
              <div>
                <p className="text-sm font-medium">{puzzle.definition.title}</p>
                <p className="text-xs text-muted-foreground">
                  {puzzle.definition.presentation === 'map' ? 'Map' : 'Text'} ·{' '}
                  {puzzle.definition.archetype} · {sourceLabel(puzzle.source)}
                  {puzzle.plotPointIndex !== null &&
                    plotPoints[puzzle.plotPointIndex] &&
                    ` · ${plotPoints[puzzle.plotPointIndex].title}`}
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => removePuzzle(puzzle.localId)}
              >
                Remove
              </Button>
            </div>
          ))}
        </div>
      )}

      {adding ? (
        <PuzzleCompilerPanel
          model={setup.model}
          plot={setup.plot}
          plotPointIndex={null}
          onSave={(draft) => {
            addPuzzle(draft)
            setAdding(false)
          }}
          onCancel={() => setAdding(false)}
        />
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setAdding(true)}
          className="self-start"
        >
          Add puzzle
        </Button>
      )}
    </div>
  )
}

function sourceLabel(source: string): string {
  if (source === 'detected') return 'detected from plot'
  if (source === 'template') return 'template'
  return 'custom'
}
