import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { CampaignSetup, PlotPointsGeneratedResponse } from '../types'

export function generatePlotPoints(
  jobId: string,
  setup: CampaignSetup,
): Promise<PlotPointsGeneratedResponse> {
  return sendRealtimeRequest<CampaignSetup, PlotPointsGeneratedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'generate-plot-points',
    responseEvent: 'plot-points-generated',
    jobId,
    payload: setup,
    timeoutMs: TIMEOUTS.generatePlotPoints,
  })
}
