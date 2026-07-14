import { useRef, useState } from 'react'
import { useSession } from '@/features/auth'
import type { DraftPuzzle } from '@/features/puzzles'
import { timeJob } from '@/lib/job-timer'
import { detectPuzzles } from '../api/detect-puzzles'
import { generatePlot } from '../api/generate-plot'
import { generatePlotPoints } from '../api/generate-plot-points'
import { improvePlot } from '../api/improve-plot'
import { listPlotDrafts } from '../api/list-plot-drafts'
import { regeneratePlotPoints } from '../api/regenerate-plot-points'
import { saveCampaign } from '../api/save-campaign'
import { savePlotDraft } from '../api/save-plot-draft'
import { buildDefaultLocks } from '../plot-point-locks'
import type {
  CampaignSetup,
  PlotDraft,
  PlotDraftSource,
  PlotPoint,
  PlotPointLocks,
} from '../types'

export type CampaignManagerStep = 'setup' | 'plot-points' | 'saved'

const DEFAULT_SETUP: CampaignSetup = {
  model: '',
  plot: '',
  campaignType: 'multi-chapter',
}

export function useCampaignManager() {
  const { session } = useSession()
  const userId = session?.user.id

  const [step, setStep] = useState<CampaignManagerStep>('setup')
  const [setup, setSetup] = useState<CampaignSetup>(DEFAULT_SETUP)

  const [plotCost, setPlotCost] = useState<number | null>(null)
  const [plotPoints, setPlotPoints] = useState<PlotPoint[] | null>(null)
  const [generationCost, setGenerationCost] = useState<number | null>(null)
  const [locks, setLocks] = useState<PlotPointLocks | null>(null)
  const [savedCampaignId, setSavedCampaignId] = useState<number | null>(null)

  const [puzzles, setPuzzles] = useState<DraftPuzzle[]>([])
  const [isDetectingPuzzles, setIsDetectingPuzzles] = useState(false)
  const [puzzleDetectionCost, setPuzzleDetectionCost] = useState(0)

  // Instant, in-memory undo — no round trip needed to step backward through what's been typed
  // or generated in this session.
  const [plotHistoryStack, setPlotHistoryStack] = useState<string[]>([])
  // Persisted history (this user's own drafts, across sessions) for the history popover —
  // fetched lazily when it's opened.
  const [plotDrafts, setPlotDrafts] = useState<PlotDraft[]>([])
  const [isLoadingHistory, setIsLoadingHistory] = useState(false)
  // Avoids re-saving the same content twice in a row (e.g. opening the popover right after a
  // generate call that already recorded its own result).
  const lastRecordedDraftRef = useRef<string | null>(null)

  const [isGeneratingPlot, setIsGeneratingPlot] = useState(false)
  const [isImprovingPlot, setIsImprovingPlot] = useState(false)
  const [isGeneratingPlotPoints, setIsGeneratingPlotPoints] = useState(false)
  const [isRegenerating, setIsRegenerating] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const updateSetup = (patch: Partial<CampaignSetup>) => {
    setSetup((prev) => ({ ...prev, ...patch }))
  }

  const recordPlotDraft = (content: string, source: PlotDraftSource) => {
    lastRecordedDraftRef.current = content
    if (!userId) return
    timeJob('save-plot-draft', (jobId) => savePlotDraft(jobId, { userId, content, source })).catch(() => {})
  }

  // Snapshots whatever is currently in the textarea — unless it's empty or already the most
  // recently recorded draft — right before a Generate/Improve/restore action overwrites it.
  // This is what makes undo/history work off a plain append-only log rather than a separate
  // undo-stack concept.
  const snapshotCurrentPlot = () => {
    const current = setup.plot
    if (!current.trim() || current === lastRecordedDraftRef.current) return
    setPlotHistoryStack((prev) => [...prev, current])
    recordPlotDraft(current, 'written')
  }

  const generatePlotIdea = async () => {
    if (!setup.model) {
      setError('Pick a model first.')
      return
    }
    snapshotCurrentPlot()
    setIsGeneratingPlot(true)
    setError(null)
    try {
      const { result } = await timeJob('generate-plot', (jobId) => generatePlot(jobId, setup.model))
      updateSetup({ plot: result.plot })
      setPlotCost(result.cost)
      recordPlotDraft(result.plot, 'generated')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsGeneratingPlot(false)
    }
  }

  const improvePlotText = async () => {
    if (!setup.model) {
      setError('Pick a model first.')
      return
    }
    snapshotCurrentPlot()
    setIsImprovingPlot(true)
    setError(null)
    try {
      const { result } = await timeJob('improve-plot', (jobId) =>
        improvePlot(jobId, setup.model, setup.plot),
      )
      updateSetup({ plot: result.plot })
      setPlotCost(result.cost)
      recordPlotDraft(result.plot, 'improved')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsImprovingPlot(false)
    }
  }

  const undoPlot = () => {
    setPlotHistoryStack((prev) => {
      if (prev.length === 0) return prev
      updateSetup({ plot: prev[prev.length - 1] })
      return prev.slice(0, -1)
    })
  }

  const loadPlotHistory = async () => {
    if (!userId) return
    setIsLoadingHistory(true)
    setError(null)
    try {
      const { result } = await timeJob('list-plot-drafts', (jobId) => listPlotDrafts(jobId, userId))
      setPlotDrafts(result.drafts)
      if (result.drafts.length > 0) lastRecordedDraftRef.current = result.drafts[0].content
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsLoadingHistory(false)
    }
  }

  const restoreFromHistory = (draft: PlotDraft) => {
    snapshotCurrentPlot()
    updateSetup({ plot: draft.content })
  }

  const generateCampaignPlotPoints = async () => {
    setIsGeneratingPlotPoints(true)
    setError(null)
    try {
      const { result } = await timeJob('generate-plot-points', (jobId) =>
        generatePlotPoints(jobId, setup),
      )
      setPlotPoints(result.plotPoints)
      setGenerationCost(result.cost)
      setLocks(buildDefaultLocks(result.plotPoints))
      setStep('plot-points')
      void detectSuggestedPuzzles(result.plotPoints)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsGeneratingPlotPoints(false)
    }
  }

  // Auto-run once on entering the plot-points step; also exposed for a manual re-run button.
  const detectSuggestedPuzzles = async (points?: PlotPoint[]) => {
    const targetPoints = points ?? plotPoints
    if (!targetPoints || !setup.model) return
    setIsDetectingPuzzles(true)
    try {
      const { result } = await timeJob('detect-puzzles', (jobId) =>
        detectPuzzles(jobId, { model: setup.model, plot: setup.plot, plotPoints: targetPoints }),
      )
      const detected: DraftPuzzle[] = result.puzzles.map((p) => ({
        localId: `detected-${crypto.randomUUID()}`,
        definition: p.definition,
        source: 'detected',
        plotPointIndex: p.plotPointIndex,
      }))
      setPuzzles((prev) => [...prev, ...detected])
      setPuzzleDetectionCost((prev) => prev + result.cost)
    } catch (err) {
      // Detection is a suggestion pass — a failure shouldn't block the plot-points step.
      console.error('Puzzle detection failed:', err)
    } finally {
      setIsDetectingPuzzles(false)
    }
  }

  const addPuzzle = (puzzle: DraftPuzzle) => {
    setPuzzles((prev) => [...prev, puzzle])
  }

  const removePuzzle = (localId: string) => {
    setPuzzles((prev) => prev.filter((p) => p.localId !== localId))
  }

  const regenerateUnlockedPlotPoints = async () => {
    if (!plotPoints || !locks) return
    setIsRegenerating(true)
    setError(null)
    try {
      const { result } = await timeJob('regenerate-plot-points', (jobId) =>
        regeneratePlotPoints(jobId, {
          model: setup.model,
          plot: setup.plot,
          plotPoints,
          locks,
        }),
      )
      setPlotPoints(result.plotPoints)
      setGenerationCost((prev) => (prev ?? 0) + result.cost)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error')
    } finally {
      setIsRegenerating(false)
    }
  }

  const updatePlotPoint = (index: number, patch: Partial<PlotPoint>) => {
    setPlotPoints((prev) => {
      if (!prev) return prev
      return prev.map((point, i) => (i === index ? { ...point, ...patch } : point))
    })
  }

  const togglePlotPointLock = (index: number) => {
    setLocks((prev) => {
      if (!prev) return prev
      return prev.map((locked, i) => (i === index ? !locked : locked))
    })
  }

  const saveGeneratedCampaign = async () => {
    if (!plotPoints) return
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
          plotPoints,
          plotCost: plotCost ?? 0,
          generationCost: generationCost ?? 0,
          puzzles: puzzles.map((p) => ({
            plotPointIndex: p.plotPointIndex,
            source: p.source,
            definition: p.definition,
          })),
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
    plotPoints,
    generationCost,
    locks,
    savedCampaignId,
    plotHistoryStack,
    plotDrafts,
    isLoadingHistory,
    isGeneratingPlot,
    isImprovingPlot,
    isGeneratingPlotPoints,
    isRegenerating,
    isSaving,
    error,
    puzzles,
    isDetectingPuzzles,
    puzzleDetectionCost,
    generatePlotIdea,
    improvePlotText,
    undoPlot,
    loadPlotHistory,
    restoreFromHistory,
    generateCampaignPlotPoints,
    regenerateUnlockedPlotPoints,
    updatePlotPoint,
    togglePlotPointLock,
    saveGeneratedCampaign,
    backToSetup,
    detectSuggestedPuzzles,
    addPuzzle,
    removePuzzle,
  }
}
