import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { PlotNarrationStartedResponse } from '../types'

export function narratePlot(jobId: string, campaignId: number): Promise<PlotNarrationStartedResponse> {
  return sendRealtimeRequest<{ campaignId: number }, PlotNarrationStartedResponse>({
    channelTopic: TOPICS.narratePlot,
    requestEvent: 'narrate-plot',
    responseEvent: 'plot-narration-started',
    jobId,
    payload: { campaignId },
    timeoutMs: TIMEOUTS.narratePlot,
  })
}
