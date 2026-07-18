// Pure snapshot-stack logic for the plot idea's undo/redo (F03 SS3.4). Kept import-light and
// side-effect-free so Vitest covers it directly (see plot-history.test.ts).
import type { PlotHistory } from './types'

export const MAX_PLOT_HISTORY_ENTRIES = 25

export function emptyPlotHistory(): PlotHistory {
  return { entries: [''], index: 0 }
}

export function currentPlotEntry(history: PlotHistory): string {
  return history.entries[history.index] ?? ''
}

/**
 * Commits `text` as the new current state: truncates any redo entries past the cursor ("redo
 * cleared on new edit") and drops the oldest entries beyond the 25-entry cap. No-op when `text`
 * already equals the current entry.
 */
export function commitPlotEntry(history: PlotHistory, text: string): PlotHistory {
  if (text === currentPlotEntry(history)) return history
  const entries = [...history.entries.slice(0, history.index + 1), text].slice(-MAX_PLOT_HISTORY_ENTRIES)
  return { entries, index: entries.length - 1 }
}

export function canUndoPlot(history: PlotHistory): boolean {
  return history.index > 0
}

export function canRedoPlot(history: PlotHistory): boolean {
  return history.index < history.entries.length - 1
}

export function undoPlot(history: PlotHistory): PlotHistory {
  return canUndoPlot(history) ? { ...history, index: history.index - 1 } : history
}

export function redoPlot(history: PlotHistory): PlotHistory {
  return canRedoPlot(history) ? { ...history, index: history.index + 1 } : history
}

/** Repairs whatever shape landed in the plot_history jsonb column (old rows, manual edits). */
export function normalizePlotHistory(value: unknown, currentPlot: string): PlotHistory {
  if (value !== null && typeof value === 'object' && Array.isArray((value as PlotHistory).entries)) {
    const raw = (value as PlotHistory).entries
    const entries = raw.filter((entry): entry is string => typeof entry === 'string').slice(-MAX_PLOT_HISTORY_ENTRIES)
    if (entries.length > 0) {
      const rawIndex = (value as PlotHistory).index
      const index =
        typeof rawIndex === 'number' && Number.isInteger(rawIndex)
          ? Math.min(Math.max(rawIndex, 0), entries.length - 1)
          : entries.length - 1
      return { entries, index }
    }
  }
  return { entries: [currentPlot], index: 0 }
}
