import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { PlotImprovedResponse } from '../types'

export function improvePlot(jobId: string, model: string, plot: string): Promise<PlotImprovedResponse> {
  return sendRealtimeRequest<{ model: string; plot: string }, PlotImprovedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'improve-plot',
    responseEvent: 'plot-improved',
    jobId,
    payload: { model, plot },
    timeoutMs: TIMEOUTS.improvePlot,
  })
}
