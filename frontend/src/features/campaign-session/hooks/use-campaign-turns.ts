import { useEffect, useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { subscribeToBroadcast } from '@/lib/realtime-channel'
import { listTurns } from '../api/list-turns'
import { CAMPAIGN_LIVE_TOPIC } from '../constants'
import type { Turn, TurnPublishedEvent } from '../types'

/** Loads turn history once, then stays subscribed to campaign-live for newly published turns. */
export function useCampaignTurns(campaignId: number) {
  const [turns, setTurns] = useState<Turn[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const { result } = await timeJob('list-turns', (jobId) => listTurns(jobId, campaignId))
        if (!cancelled) setTurns(result.turns)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    const unsubscribe = subscribeToBroadcast<TurnPublishedEvent>(
      CAMPAIGN_LIVE_TOPIC,
      'turn-published',
      (event) => {
        if (event.campaignId !== campaignId) return
        setTurns((prev) => [...prev, event.turn])
      },
    )

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [campaignId])

  return { turns, isLoading, error }
}
