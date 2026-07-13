import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { CampaignFetchedResponse } from '../types'

export function getCampaign(jobId: string, campaignId: number): Promise<CampaignFetchedResponse> {
  return sendRealtimeRequest<{ campaignId: number }, CampaignFetchedResponse>({
    channelTopic: TOPICS.getCampaign,
    requestEvent: 'get-campaign',
    responseEvent: 'campaign-fetched',
    jobId,
    payload: { campaignId },
    timeoutMs: TIMEOUTS.getCampaign,
  })
}
