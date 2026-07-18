import { useCallback, useState } from 'react'

import { timeJob } from '@/lib/job-timer'
import { generatePlot, improvePlot, type PlotAiContext } from '../api/plot-ai'
import {
  canRedoPlot,
  canUndoPlot,
  commitPlotEntry,
  currentPlotEntry,
  redoPlot,
  undoPlot,
} from '../plot-history'
import type { AdventureDraft } from '../types'

interface PlotEditorState {
  isGenerating: boolean
  aiError: string | null
  canUndo: boolean
  canRedo: boolean
  handleUndo: () => void
  handleRedo: () => void
  handleBlur: () => void
  handleGenerateOrImprove: () => Promise<void>
  handleInsertPrevious: (plot: string) => void
}

// Drives the plot textarea's AI button, undo/redo, and previous-ideas insertion over the draft
// held by useAdventureDraft. History semantics (F03 SS3.4): snapshots are committed on AI
// generate/improve, previous-idea insertion, and manual blur with changes; undo/redo moves the
// cursor; any new commit clears the redo tail (see plot-history.ts).
export function usePlotEditor(
  draft: AdventureDraft,
  updateDraft: (patch: Partial<AdventureDraft>) => void,
): PlotEditorState {
  const [isGenerating, setIsGenerating] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)

  const handleBlur = useCallback(() => {
    const committed = commitPlotEntry(draft.plotHistory, draft.plotIdea)
    if (committed !== draft.plotHistory) updateDraft({ plotHistory: committed })
  }, [draft.plotHistory, draft.plotIdea, updateDraft])

  const handleUndo = useCallback(() => {
    // Commit any uncommitted typing first so undo steps back from what's on screen.
    const history = undoPlot(commitPlotEntry(draft.plotHistory, draft.plotIdea))
    updateDraft({ plotIdea: currentPlotEntry(history), plotHistory: history })
  }, [draft.plotHistory, draft.plotIdea, updateDraft])

  const handleRedo = useCallback(() => {
    const history = redoPlot(draft.plotHistory)
    updateDraft({ plotIdea: currentPlotEntry(history), plotHistory: history })
  }, [draft.plotHistory, updateDraft])

  const handleInsertPrevious = useCallback(
    (plot: string) => {
      const history = commitPlotEntry(commitPlotEntry(draft.plotHistory, draft.plotIdea), plot)
      updateDraft({ plotIdea: plot, plotHistory: history })
    },
    [draft.plotHistory, draft.plotIdea, updateDraft],
  )

  const handleGenerateOrImprove = useCallback(async () => {
    if (!draft.type) {
      setAiError('Choose an adventure type first - the plot respects it.')
      return
    }
    const context: PlotAiContext = {
      type: draft.type,
      chaptersMin: draft.chaptersMin,
      chaptersMax: draft.chaptersMax,
    }
    const isImprove = draft.plotIdea.trim().length > 0
    setIsGenerating(true)
    setAiError(null)
    try {
      const { result } = await timeJob(isImprove ? 'improve-plot' : 'generate-plot', () =>
        isImprove ? improvePlot(context, draft.plotIdea) : generatePlot(context),
      )
      // Never silently replaces (F03 SS3.4): the current text is snapshotted, then the AI
      // result lands as its own new undo state.
      const history = commitPlotEntry(commitPlotEntry(draft.plotHistory, draft.plotIdea), result)
      updateDraft({ plotIdea: result, plotHistory: history })
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Plot generation failed')
    } finally {
      setIsGenerating(false)
    }
  }, [draft.type, draft.chaptersMin, draft.chaptersMax, draft.plotIdea, draft.plotHistory, updateDraft])

  return {
    isGenerating,
    aiError,
    canUndo: canUndoPlot(commitPlotEntry(draft.plotHistory, draft.plotIdea)),
    canRedo: canRedoPlot(draft.plotHistory),
    handleUndo,
    handleRedo,
    handleBlur,
    handleGenerateOrImprove,
    handleInsertPrevious,
  }
}
