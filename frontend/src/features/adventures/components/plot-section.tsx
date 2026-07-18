import { useState } from 'react'
import { HistoryIcon, Redo2Icon, SparklesIcon, Undo2Icon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Textarea } from '@/components/ui/textarea'
import { listPreviousPlots } from '../api/list-previous-plots'
import { usePlotEditor } from '../hooks/use-plot-editor'
import { PLOT_IDEA_MAX_CHARS, type AdventureDraft } from '../types'

interface PlotSectionProps {
  adventureId: string
  draft: AdventureDraft
  updateDraft: (patch: Partial<AdventureDraft>) => void
}

// F03 SS3.4: plot idea textarea with the context-sensitive AI button (Generate when empty,
// Improve otherwise), undo/redo over the snapshot stack, and the previous-ideas dropdown.
export function PlotSection({ adventureId, draft, updateDraft }: PlotSectionProps) {
  const {
    isGenerating,
    aiError,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    handleBlur,
    handleGenerateOrImprove,
    handleInsertPrevious,
  } = usePlotEditor(draft, updateDraft)

  const [isPreviousOpen, setIsPreviousOpen] = useState(false)
  const [previousPlots, setPreviousPlots] = useState<string[] | null>(null)
  const [previousError, setPreviousError] = useState<string | null>(null)

  const isEmpty = draft.plotIdea.trim().length === 0

  // Fetched lazily the first time the popover opens.
  function handlePreviousOpenChange(open: boolean) {
    setIsPreviousOpen(open)
    if (open && previousPlots === null) {
      listPreviousPlots(adventureId)
        .then(setPreviousPlots)
        .catch((err: unknown) =>
          setPreviousError(err instanceof Error ? err.message : 'Failed to load previous ideas'),
        )
    }
  }

  return (
    <section className="flex flex-col gap-3" aria-labelledby="plot-heading">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="plot-heading" className="text-base font-medium">
          Plot idea
        </h2>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Undo plot change"
            disabled={!canUndo || isGenerating}
            onClick={handleUndo}
          >
            <Undo2Icon />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Redo plot change"
            disabled={!canRedo || isGenerating}
            onClick={handleRedo}
          >
            <Redo2Icon />
          </Button>
          <Popover open={isPreviousOpen} onOpenChange={handlePreviousOpenChange}>
            <PopoverTrigger
              render={
                <Button type="button" variant="outline" size="sm">
                  <HistoryIcon /> Previous ideas
                </Button>
              }
            />
            <PopoverContent className="flex max-h-80 w-96 flex-col gap-1 overflow-y-auto">
              {previousError && <p className="p-2 text-sm text-destructive">{previousError}</p>}
              {!previousError && previousPlots === null && (
                <p className="p-2 text-sm text-muted-foreground">Loading…</p>
              )}
              {previousPlots?.length === 0 && (
                <p className="p-2 text-sm text-muted-foreground">No plots from other adventures yet.</p>
              )}
              {previousPlots?.map((plot) => (
                <button
                  key={plot}
                  type="button"
                  className="rounded-md p-2 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                  onClick={() => {
                    handleInsertPrevious(plot)
                    setIsPreviousOpen(false)
                  }}
                >
                  <span className="line-clamp-3">{plot}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={isGenerating}
            onClick={() => void handleGenerateOrImprove()}
          >
            <SparklesIcon />
            {isGenerating ? 'Working…' : isEmpty ? 'Generate plot' : 'Improve plot'}
          </Button>
        </div>
      </div>

      <Textarea
        aria-labelledby="plot-heading"
        value={draft.plotIdea}
        maxLength={PLOT_IDEA_MAX_CHARS}
        placeholder="A premise, a hook, stakes, a tone - or press Generate and iterate from there."
        className="min-h-40"
        disabled={isGenerating}
        onChange={(event) => updateDraft({ plotIdea: event.target.value })}
        onBlur={handleBlur}
      />

      <div className="flex items-center justify-between gap-2">
        {aiError ? <p className="text-sm text-destructive">{aiError}</p> : <span />}
        <span className="text-xs text-muted-foreground tabular-nums">
          {draft.plotIdea.length}/{PLOT_IDEA_MAX_CHARS}
        </span>
      </div>
    </section>
  )
}
