import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { CampaignOutline, OutlineLocks, OutlineRegeneratedResponse } from '../types'

export type RegenerateOutlinePayload = {
  model: string
  plot: string
  outline: CampaignOutline
  chapterCount: number
  sessionsPerChapter: number
  locks: OutlineLocks
}

export function regenerateOutline(
  jobId: string,
  payload: RegenerateOutlinePayload,
): Promise<OutlineRegeneratedResponse> {
  return sendRealtimeRequest<RegenerateOutlinePayload, OutlineRegeneratedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'regenerate-outline',
    responseEvent: 'outline-regenerated',
    jobId,
    payload,
    timeoutMs: TIMEOUTS.regenerateOutline,
  })
}
