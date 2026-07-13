import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { PlotPoint, PlotPointLocks, PlotPointsRegeneratedResponse } from '../types'

export type RegeneratePlotPointsPayload = {
  model: string
  plot: string
  plotPoints: PlotPoint[]
  locks: PlotPointLocks
}

export function regeneratePlotPoints(
  jobId: string,
  payload: RegeneratePlotPointsPayload,
): Promise<PlotPointsRegeneratedResponse> {
  return sendRealtimeRequest<RegeneratePlotPointsPayload, PlotPointsRegeneratedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'regenerate-plot-points',
    responseEvent: 'plot-points-regenerated',
    jobId,
    payload,
    timeoutMs: TIMEOUTS.regeneratePlotPoints,
  })
}
