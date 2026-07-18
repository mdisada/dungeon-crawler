import { useCallback, useEffect, useRef, useState } from 'react'

import { timeJob } from '@/lib/job-timer'
import { createCharacterDraft } from '../api/create-character-draft'
import { finalizeCharacter } from '../api/finalize-character'
import { getCharacter } from '../api/get-character'
import { saveDraft } from '../api/save-draft'
import { emptyWizardDraft, normalizeDraft } from '../lib/empty-draft'
import { WIZARD_STEPS, type SrdClass, type WizardDraft, type WizardStep } from '../types'

const AUTOSAVE_DEBOUNCE_MS = 500

interface CharacterDraftState {
  characterId: string | null
  draft: WizardDraft
  isLoading: boolean
  isSaving: boolean
  error: string | null
  updateDraft: (patch: Partial<WizardDraft>) => void
  goToStep: (step: WizardStep) => void
  goNext: () => void
  goBack: () => void
  finalize: (srdClass: SrdClass) => Promise<void>
}

// Owns the full wizard lifecycle: creates (or loads) the character row, holds the working draft,
// autosaves on every draft change (debounced - F02 SS3: "every step persists to a draft jsonb
// column so users can resume"), and finalizes on Review & Save.
export function useCharacterDraft(userId: string | undefined, existingCharacterId?: string): CharacterDraftState {
  const [characterId, setCharacterId] = useState<string | null>(existingCharacterId ?? null)
  const [draft, setDraft] = useState<WizardDraft>(emptyWizardDraft())
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
        const character = existingCharacterId
          ? await getCharacter(existingCharacterId)
          : await createCharacterDraft(userId as string)
        if (cancelled) return
        skipNextAutosave.current = true
        setCharacterId(character.id)
        setDraft(character.draft ? normalizeDraft(character.draft) : emptyWizardDraft())
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load character')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    void init()
    return () => {
      cancelled = true
    }
  }, [userId, existingCharacterId])

  useEffect(() => {
    if (!characterId) return
    if (skipNextAutosave.current) {
      skipNextAutosave.current = false
      return
    }
    setIsSaving(true)
    const timeoutId = window.setTimeout(() => {
      timeJob('save-character-draft', () => saveDraft(characterId, draft))
        .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed to save draft'))
        .finally(() => setIsSaving(false))
    }, AUTOSAVE_DEBOUNCE_MS)
    return () => window.clearTimeout(timeoutId)
  }, [characterId, draft])

  const updateDraft = useCallback((patch: Partial<WizardDraft>) => {
    setDraft((prev) => ({ ...prev, ...patch }))
  }, [])

  const goToStep = useCallback((step: WizardStep) => {
    setDraft((prev) => ({ ...prev, step }))
  }, [])

  const goNext = useCallback(() => {
    setDraft((prev) => {
      const currentIndex = WIZARD_STEPS.indexOf(prev.step)
      const nextStep = WIZARD_STEPS[Math.min(currentIndex + 1, WIZARD_STEPS.length - 1)]
      return { ...prev, step: nextStep }
    })
  }, [])

  const goBack = useCallback(() => {
    setDraft((prev) => {
      const currentIndex = WIZARD_STEPS.indexOf(prev.step)
      const prevStep = WIZARD_STEPS[Math.max(currentIndex - 1, 0)]
      return { ...prev, step: prevStep }
    })
  }, [])

  const finalize = useCallback(
    async (srdClass: SrdClass) => {
      if (!characterId) throw new Error('No character to save')
      setIsSaving(true)
      setError(null)
      try {
        await timeJob('finalize-character', () => finalizeCharacter(characterId, draft, srdClass))
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to save character')
        throw err
      } finally {
        setIsSaving(false)
      }
    },
    [characterId, draft],
  )

  return { characterId, draft, isLoading, isSaving, error, updateDraft, goToStep, goNext, goBack, finalize }
}
