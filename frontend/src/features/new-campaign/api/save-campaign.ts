import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { CampaignOutline, CampaignSavedResponse, CampaignType, OutlineLocks } from '../types'

export type SaveCampaignPayload = {
  userId: string
  model: string
  plot: string
  campaignType: CampaignType
  chapterCount: number
  sessionsPerChapter: number
  outline: CampaignOutline
  plotCost: number
  outlineCost: number
  locks: OutlineLocks
}

export function saveCampaign(
  jobId: string,
  payload: SaveCampaignPayload,
): Promise<CampaignSavedResponse> {
  return sendRealtimeRequest<SaveCampaignPayload, CampaignSavedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'save-campaign',
    responseEvent: 'campaign-saved',
    jobId,
    payload,
    timeoutMs: TIMEOUTS.saveCampaign,
  })
}
