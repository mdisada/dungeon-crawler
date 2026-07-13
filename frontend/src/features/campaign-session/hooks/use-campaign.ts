import { useEffect, useState } from 'react'
import { timeJob } from '@/lib/job-timer'
import { getCampaign } from '../api/get-campaign'
import type { CampaignSummary } from '../types'

export function useCampaign(campaignId: number) {
  const [campaign, setCampaign] = useState<CampaignSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      setIsLoading(true)
      try {
        const { result } = await timeJob('get-campaign', (jobId) => getCampaign(jobId, campaignId))
        if (!cancelled) setCampaign(result.campaign)
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
  }, [campaignId])

  return { campaign, isLoading, error }
}
