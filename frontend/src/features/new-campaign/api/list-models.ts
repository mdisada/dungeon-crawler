import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { ModelsListResponse } from '../types'

export function listModels(jobId: string): Promise<ModelsListResponse> {
  return sendRealtimeRequest<Record<string, never>, ModelsListResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'list-models',
    responseEvent: 'models-list',
    jobId,
    payload: {},
    timeoutMs: TIMEOUTS.listModels,
  })
}
