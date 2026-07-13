import { useState } from 'react'
import { useSession } from '@/features/auth'
import { timeJob } from '@/lib/job-timer'
import { generateOutline } from '../api/generate-outline'
import { generatePlot } from '../api/generate-plot'
import { regenerateOutline } from '../api/regenerate-outline'
import { saveCampaign } from '../api/save-campaign'
import { buildDefaultLocks } from '../outline-locks'
import type { CampaignOutline, CampaignSetup, ChapterOutline, OutlineLocks, SessionOutline } from '../types'

export type CampaignManagerStep = 'setup' | 'outline' | 'saved'

const DEFAULT_SETUP: CampaignSetup = {
  model: '',
  plot: '',
  campaignType: 'multi-chapter',
  minChapters: 3,
  maxChapters: 5,
  minSessionsPerChapter: 2,
  maxSessionsPerChapter: 4,
}

export function useCampaignManager() {
  const { session } = useSession()

  const [step, setStep] = useState<CampaignManagerStep>('setup')
  const [setup, setSetup] = useState<CampaignSetup>(DEFAULT_SETUP)

  const [plotCost, setPlotCost] = useState<number | null>(null)
  const [outline, setOutline] = useState<CampaignOutline | null>(null)
  const [outlineCost, setOutlineCost] = useState<number | null>(null)
  const [chapterCount, setChapterCount] = useState<number | null>(null)
  const [sessionsPerChapter, setSessionsPerChapter] = useState<number | null>(null)
  const [locks, setLocks] = useState<OutlineLocks | null>(null)
  const [savedCampaignId, setSavedCampaignId] = useState<number | null>(null)

  const [isGeneratingPlot, setIsGeneratingPlot] = useState(false)
  const [isGeneratingOutline, setIsGeneratingOutline] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateSetup = (patch: Partial<CampaignSetup>) => {
    setSetup((prev) => ({ ...prev, ...patch }))
  }

  const generatePlotIdea = async () => {
    if (!setup.model) {
      setError('Pick a model first.')
      return
    }
    setIsGeneratingPlot(true)
    setError(null)
    try {
      const { result } = await timeJob('generate-plot', (jobId) => generatePlot(jobId, setup.model))
      updateSetup({ plot: result.plot })
      setPlotCost(result.cost)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsGeneratingPlot(false)
    }
  }

  const generateCampaignOutline = async () => {
    setIsGeneratingOutline(true)
    setError(null)
    try {
      const { result } = await timeJob('generate-outline', (jobId) => generateOutline(jobId, setup))
      setOutline(result.outline)
      setOutlineCost(result.cost)
      setChapterCount(result.chapterCount)
      setSessionsPerChapter(result.sessionsPerChapter)
      setLocks(buildDefaultLocks(result.outline))
      setStep('outline')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsGeneratingOutline(false)
    }
  }

  const regenerateUnlockedChapters = async () => {
    if (!outline || !locks || chapterCount === null || sessionsPerChapter === null) return
    setIsRegenerating(true)
    setError(null)
    try {
      const { result } = await timeJob('regenerate-outline', (jobId) =>
        regenerateOutline(jobId, {
          model: setup.model,
          plot: setup.plot,
          outline,
          chapterCount,
          sessionsPerChapter,
          locks,
        }),
      )
      setOutline(result.outline)
      setOutlineCost((prev) => (prev ?? 0) + result.cost)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsRegenerating(false)
    }
  }

  const updateChapter = (chapterIndex: number, patch: Partial<ChapterOutline>) => {
    setOutline((prev) => {
      if (!prev) return prev
      const chapters = prev.chapters.map((chapter, i) =>
        i === chapterIndex ? { ...chapter, ...patch } : chapter,
      )
      return { ...prev, chapters }
    })
  }

  const updateSession = (chapterIndex: number, sessionIndex: number, patch: Partial<SessionOutline>) => {
    setOutline((prev) => {
      if (!prev) return prev
      const chapters = prev.chapters.map((chapter, i) => {
        if (i !== chapterIndex) return chapter
        const sessions = chapter.sessions.map((session, j) =>
          j === sessionIndex ? { ...session, ...patch } : session,
        )
        return { ...chapter, sessions }
      })
      return { ...prev, chapters }
    })
  }

  const toggleChapterLock = (chapterIndex: number) => {
    setLocks((prev) => {
      if (!prev) return prev
      const chapters = prev.chapters.map((chapterLock, i) =>
        i === chapterIndex ? { ...chapterLock, locked: !chapterLock.locked } : chapterLock,
      )
      return { chapters }
    })
  }

  const toggleSessionLock = (chapterIndex: number, sessionIndex: number) => {
    setLocks((prev) => {
      if (!prev) return prev
      const chapters = prev.chapters.map((chapterLock, i) => {
        if (i !== chapterIndex) return chapterLock
        const sessions = chapterLock.sessions.map((locked, j) => (j === sessionIndex ? !locked : locked))
        return { ...chapterLock, sessions }
      })
      return { chapters }
    })
  }

  const saveGeneratedCampaign = async () => {
    if (!outline || !locks || chapterCount === null || sessionsPerChapter === null) return
    const userId = session?.user.id
    if (!userId) {
      setError('You must be signed in to save a campaign.')
      return
    }
    setIsSaving(true)
    setError(null)
    try {
      const { result } = await timeJob('save-campaign', (jobId) =>
        saveCampaign(jobId, {
          userId,
          model: setup.model,
          plot: setup.plot,
          campaignType: setup.campaignType,
          chapterCount,
          sessionsPerChapter,
          outline,
          plotCost: plotCost ?? 0,
          outlineCost: outlineCost ?? 0,
          locks,
        }),
      )
      setSavedCampaignId(result.campaignId)
      setStep('saved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsSaving(false)
    }
  }

  const backToSetup = () => {
    setStep('setup')
    setError(null)
  }

  return {
    step,
    setup,
    updateSetup,
    plotCost,
    outline,
    outlineCost,
    chapterCount,
    sessionsPerChapter,
    locks,
    savedCampaignId,
    isGeneratingPlot,
    isGeneratingOutline,
    isRegenerating,
    isSaving,
    error,
    generatePlotIdea,
    generateCampaignOutline,
    regenerateUnlockedChapters,
    updateChapter,
    updateSession,
    toggleChapterLock,
    toggleSessionLock,
    saveGeneratedCampaign,
    backToSetup,
  }
}
