import { useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { compilePuzzle } from '../api/compile-puzzle'
import { PUZZLE_TEMPLATES } from '../templates'
import type { DraftPuzzle, PuzzleDefinition } from '../types'

export type PuzzleCompilerStatus = 'idle' | 'compiling' | 'reviewing'

let localIdCounter = 0
function nextLocalId(): string {
  localIdCounter += 1
  return `draft-${Date.now()}-${localIdCounter}`
}

export function usePuzzleCompiler(model: string, plot: string) {
  const [status, setStatus] = useState<PuzzleCompilerStatus>('idle')
  const [draft, setDraft] = useState<PuzzleDefinition | null>(null)
  const [source, setSource] = useState<DraftPuzzle['source']>('custom')
  const [cost, setCost] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const reset = () => {
    setStatus('idle')
    setDraft(null)
    setCost(0)
    setError(null)
  }

  const compile = async (description: string, archetype: string) => {
    if (!model) {
      setError('Pick a model first.')
      return
    }
    setStatus('compiling')
    setError(null)
    try {
      const { result } = await timeJob('compile-puzzle', (jobId) =>
        compilePuzzle(jobId, { model, description, archetype, plot }),
      )
      setDraft(result.definition)
      setSource('custom')
      setCost(result.cost)
      setStatus('reviewing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('idle')
    }
  }

  const loadTemplate = (templateId: string) => {
    const template = PUZZLE_TEMPLATES.find((t) => t.id === templateId)
    if (!template) return
    setDraft(template.definition)
    setSource('template')
    setCost(0)
    setError(null)
    setStatus('reviewing')
  }

  const adaptToCampaign = async (feedback?: string) => {
    if (!draft) return
    if (!model) {
      setError('Pick a model first.')
      return
    }
    setStatus('compiling')
    setError(null)
    try {
      const { result } = await timeJob('compile-puzzle', (jobId) =>
        compilePuzzle(jobId, {
          model,
          description: '',
          archetype: draft.archetype,
          existingDefinition: draft,
          feedback: feedback ?? 'Re-theme this puzzle to fit the campaign premise.',
          plot,
        }),
      )
      setDraft(result.definition)
      setCost((prev) => prev + result.cost)
      setStatus('reviewing')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
      setStatus('reviewing')
    }
  }

  const updateDraft = (patch: Partial<PuzzleDefinition>) => {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
  }

  const toDraftPuzzle = (plotPointIndex: number | null): DraftPuzzle | null => {
    if (!draft) return null
    return { localId: nextLocalId(), definition: draft, source, plotPointIndex }
  }

  return {
    status,
    draft,
    source,
    cost,
    error,
    compile,
    loadTemplate,
    adaptToCampaign,
    updateDraft,
    toDraftPuzzle,
    reset,
  }
}
