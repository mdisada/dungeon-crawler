import { Button } from '@/components/ui/button'
import { usePuzzleCompiler } from '../hooks/use-puzzle-compiler'
import type { DraftPuzzle } from '../types'
import { PuzzleReviewCard } from './puzzle-review-card'
import { PuzzleSourcePicker } from './puzzle-source-picker'

type Props = {
  model: string
  plot: string
  plotPointIndex: number | null
  onSave: (puzzle: DraftPuzzle) => void
  onCancel: () => void
}

export function PuzzleCompilerPanel({ model, plot, plotPointIndex, onSave, onCancel }: Props) {
  const compiler = usePuzzleCompiler(model, plot)
  const busy = compiler.status === 'compiling'

  const handleSave = () => {
    const draft = compiler.toDraftPuzzle(plotPointIndex)
    if (draft) onSave(draft)
  }

  return (
    <div className="flex flex-col gap-3">
      {compiler.error && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {compiler.error}
        </p>
      )}

      {compiler.status === 'reviewing' && compiler.draft ? (
        <PuzzleReviewCard
          draft={compiler.draft}
          cost={compiler.cost}
          busy={busy}
          onUpdate={compiler.updateDraft}
          onAdapt={() => compiler.adaptToCampaign()}
          onSave={handleSave}
          onDiscard={onCancel}
        />
      ) : (
        <>
          <PuzzleSourcePicker
            busy={busy}
            onPickTemplate={compiler.loadTemplate}
            onCompile={compiler.compile}
          />
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} className="self-start">
            Cancel
          </Button>
        </>
      )}
    </div>
  )
}
