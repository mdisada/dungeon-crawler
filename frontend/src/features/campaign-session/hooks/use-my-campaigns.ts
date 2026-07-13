import { useEffect, useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { listCampaigns } from '../api/list-campaigns'
import type { CampaignSummary } from '../types'

export function useMyCampaigns(userId: string | undefined) {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!userId) return
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const { result } = await timeJob('list-campaigns', (jobId) => listCampaigns(jobId, userId))
        if (!cancelled) setCampaigns(result.campaigns)
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Unknown error')
      } finally {
        if (!cancelled) setIsLoading(false)
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [userId])

  return { campaigns, isLoading, error }
}
