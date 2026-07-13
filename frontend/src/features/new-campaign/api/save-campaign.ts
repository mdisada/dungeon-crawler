import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { CampaignSavedResponse, CampaignType, PlotPoint } from '../types'

export type SaveCampaignPayload = {
  userId: string
  model: string
  plot: string
  campaignType: CampaignType
  plotPoints: PlotPoint[]
  plotCost: number
  generationCost: number
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
