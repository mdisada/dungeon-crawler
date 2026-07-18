import { describe, expect, it } from 'vitest'

import {
  canRedoPlot,
  canUndoPlot,
  commitPlotEntry,
  currentPlotEntry,
  emptyPlotHistory,
  MAX_PLOT_HISTORY_ENTRIES,
  normalizePlotHistory,
  redoPlot,
  undoPlot,
} from './plot-history'

describe('commitPlotEntry', () => {
  it('appends a new entry and moves the cursor to it', () => {
    const history = commitPlotEntry(emptyPlotHistory(), 'a dragon heist')
    expect(history.entries).toEqual(['', 'a dragon heist'])
    expect(currentPlotEntry(history)).toBe('a dragon heist')
  })

  it('is a no-op when the text equals the current entry', () => {
    const history = commitPlotEntry(emptyPlotHistory(), 'same')
    expect(commitPlotEntry(history, 'same')).toBe(history)
  })

  it('clears the redo tail on a new commit', () => {
    let history = commitPlotEntry(emptyPlotHistory(), 'v1')
    history = commitPlotEntry(history, 'v2')
    history = undoPlot(history)
    expect(canRedoPlot(history)).toBe(true)
    history = commitPlotEntry(history, 'v3')
    expect(history.entries).toEqual(['', 'v1', 'v3'])
    expect(canRedoPlot(history)).toBe(false)
  })

  it('caps the stack at MAX_PLOT_HISTORY_ENTRIES, dropping the oldest', () => {
    let history = emptyPlotHistory()
    for (let i = 0; i < MAX_PLOT_HISTORY_ENTRIES + 5; i++) {
      history = commitPlotEntry(history, `v${i}`)
    }
    expect(history.entries).toHaveLength(MAX_PLOT_HISTORY_ENTRIES)
    expect(history.entries[0]).toBe('v5')
    expect(currentPlotEntry(history)).toBe(`v${MAX_PLOT_HISTORY_ENTRIES + 4}`)
  })
})

describe('undo/redo', () => {
  it('traverses AI and manual states in both directions', () => {
    let history = commitPlotEntry(emptyPlotHistory(), 'manual draft')
    history = commitPlotEntry(history, 'ai improved')

    history = undoPlot(history)
    expect(currentPlotEntry(history)).toBe('manual draft')
    history = undoPlot(history)
    expect(currentPlotEntry(history)).toBe('')
    expect(canUndoPlot(history)).toBe(false)

    history = redoPlot(history)
    history = redoPlot(history)
    expect(currentPlotEntry(history)).toBe('ai improved')
    expect(canRedoPlot(history)).toBe(false)
  })

  it('is a no-op at the stack boundaries', () => {
    const history = emptyPlotHistory()
    expect(undoPlot(history)).toBe(history)
    expect(redoPlot(history)).toBe(history)
  })
})

describe('normalizePlotHistory', () => {
  it('passes a valid persisted shape through', () => {
    const normalized = normalizePlotHistory({ entries: ['', 'v1'], index: 1 }, 'v1')
    expect(normalized).toEqual({ entries: ['', 'v1'], index: 1 })
  })

  it('clamps an out-of-range index', () => {
    expect(normalizePlotHistory({ entries: ['a', 'b'], index: 9 }, 'b').index).toBe(1)
    expect(normalizePlotHistory({ entries: ['a', 'b'], index: -2 }, 'b').index).toBe(0)
  })

  it('drops non-string entries and falls back to the current plot when nothing survives', () => {
    expect(normalizePlotHistory({ entries: [1, null], index: 0 }, 'current')).toEqual({
      entries: ['current'],
      index: 0,
    })
  })

  it('falls back to the current plot for junk values', () => {
    for (const junk of [null, undefined, 'text', 42, { index: 3 }]) {
      expect(normalizePlotHistory(junk, 'the plot')).toEqual({ entries: ['the plot'], index: 0 })
    }
  })
})
