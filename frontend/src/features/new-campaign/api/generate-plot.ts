import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { PlotGeneratedResponse } from '../types'

export function generatePlot(jobId: string, model: string): Promise<PlotGeneratedResponse> {
  return sendRealtimeRequest<{ model: string }, PlotGeneratedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'generate-plot',
    responseEvent: 'plot-generated',
    jobId,
    payload: { model },
    timeoutMs: TIMEOUTS.generatePlot,
  })
}
