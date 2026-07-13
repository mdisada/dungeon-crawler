import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { CampaignSetup, OutlineGeneratedResponse } from '../types'

export function generateOutline(
  jobId: string,
  setup: CampaignSetup,
): Promise<OutlineGeneratedResponse> {
  return sendRealtimeRequest<CampaignSetup, OutlineGeneratedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'generate-outline',
    responseEvent: 'outline-generated',
    jobId,
    payload: setup,
    timeoutMs: TIMEOUTS.generateOutline,
  })
}
