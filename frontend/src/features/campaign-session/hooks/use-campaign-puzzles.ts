import { useEffect, useState } from 'react'
import type { SavedPuzzle } from '@/features/puzzles'
import { timeJob } from '@/lib/job-timer'
import { subscribeToBroadcast } from '@/lib/realtime-channel'
import { listPuzzles } from '../api/list-puzzles'
import { CAMPAIGN_LIVE_TOPIC } from '../constants'
import type { PuzzleStartedEvent } from '../types'

/** Puzzles still available for the DM to trigger (status 'ready') — drops one from the list as
 * soon as it's actually published (see use-turn-drafting's publish, which is what flips it). */
export function useCampaignPuzzles(campaignId: number) {
  const [puzzles, setPuzzles] = useState<SavedPuzzle[]>([])
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const { result } = await timeJob('list-puzzles', (jobId) => listPuzzles(jobId, campaignId))
        if (!cancelled) setPuzzles(result.puzzles)
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    const unsubscribe = subscribeToBroadcast<PuzzleStartedEvent>(CAMPAIGN_LIVE_TOPIC, 'puzzle-started', (event) => {
      if (event.campaignId !== campaignId) return
      setPuzzles((prev) => prev.filter((puzzle) => puzzle.id !== event.puzzleId))
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [campaignId])

  return { puzzles, isLoading }
}
