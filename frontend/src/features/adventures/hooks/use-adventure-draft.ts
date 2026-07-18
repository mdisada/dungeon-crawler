import { useCallback, useEffect, useRef, useState } from 'react'

import { timeJob } from '@/lib/job-timer'
import { getOrCreateAdventureDraft } from '../api/get-or-create-adventure-draft'
import { saveAdventureDraft } from '../api/save-adventure-draft'
import { startGuideGeneration } from '../api/start-guide-generation'
import { emptyPlotHistory } from '../plot-history'
import { toDraftFields, type AdventureDraft } from '../types'

// F03 SS2: "All inputs persist to a draft row immediately (autosave, debounced 1s)".
const AUTOSAVE_DEBOUNCE_MS = 1000

const EMPTY_DRAFT: AdventureDraft = {
  mode: null,
  minPlayers: 1,
  maxPlayers: 4,
  type: null,
  chaptersMin: null,
  chaptersMax: null,
  plotIdea: '',
  plotHistory: emptyPlotHistory(),
  difficultyPreset: null,
}

interface AdventureDraftState {
  adventureId: string | null
  draft: AdventureDraft
  isLoading: boolean
  isSaving: boolean
  error: string | null
  updateDraft: (patch: Partial<AdventureDraft>) => void
  startGeneration: () => Promise<void>
}

// Owns the wizard lifecycle, mirroring characters' useCharacterDraft: loads (or creates) the
// user's current draft row, holds the working fields, autosaves debounced, and flips the row to
// 'generating' on the CTA.
export function useAdventureDraft(userId: string | undefined): AdventureDraftState {
  const [adventureId, setAdventureId] = useState<string | null>(null)
  const [draft, setDraft] = useState<AdventureDraft>(EMPTY_DRAFT)
  const [isLoading, setIsLoading] = useState(true)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const skipNextAutosave = useRef(true)

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    async function init() {
      setIsLoading(true)
      setError(null)
      try {
        const adventure = await getOrCreateAdventureDraft(userId as string)
        if (cancelled) return
        skipNextAutosave.current = true
        setAdventureId(adventure.id)
        setDraft(toDraftFields(adventure))
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load adventure draft')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [userId])

  useEffect(() => {
    if (!adventureId || !userId) return
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false
      return
    }
    setIsSaving(true)
    const timeoutId = window.setTimeout(() => {
      timeJob('save-adventure-draft', () => saveAdventureDraft(adventureId, userId, draft))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save draft'))
        .finally(() => setIsSaving(false))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timeoutId)
  }, [adventureId, userId, draft])

  const updateDraft = useCallback((patch: Partial<AdventureDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  const startGeneration = useCallback(async () => {
    if (!adventureId || !userId) throw new Error('No adventure draft to generate from')
    setIsSaving(true)
    setError(null)
    try {
      // Flush the latest fields first so the pipeline reads exactly what the user saw.
      await timeJob('start-guide-generation', async () => {
        await saveAdventureDraft(adventureId, userId, draft)
        await startGuideGeneration(adventureId)
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start guide generation')
      throw err
    } finally {
      setIsSaving(false)
    }
  }, [adventureId, userId, draft])

  return { adventureId, draft, isLoading, isSaving, error, updateDraft, startGeneration }
}
