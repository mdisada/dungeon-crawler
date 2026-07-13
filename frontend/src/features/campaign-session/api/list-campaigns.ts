import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { CampaignsListedResponse } from '../types'

export function listCampaigns(jobId: string, userId: string): Promise<CampaignsListedResponse> {
  return sendRealtimeRequest<{ userId: string }, CampaignsListedResponse>({
    channelTopic: TOPICS.listCampaigns,
    requestEvent: 'list-campaigns',
    responseEvent: 'campaigns-listed',
    jobId,
    payload: { userId },
    timeoutMs: TIMEOUTS.listCampaigns,
  })
}
