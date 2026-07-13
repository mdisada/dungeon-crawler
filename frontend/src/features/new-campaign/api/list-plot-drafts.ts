import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { PlotDraftsListedResponse } from '../types'

export function listPlotDrafts(jobId: string, userId: string): Promise<PlotDraftsListedResponse> {
  return sendRealtimeRequest<{ userId: string }, PlotDraftsListedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'list-plot-drafts',
    responseEvent: 'plot-drafts-listed',
    jobId,
    payload: { userId },
    timeoutMs: TIMEOUTS.listPlotDrafts,
  })
}
