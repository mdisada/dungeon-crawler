import type { PuzzlesDetectedResponse } from '@/features/puzzles'
import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { PlotPoint } from '../types'

export type DetectPuzzlesPayload = {
  model: string
  plot: string
  plotPoints: PlotPoint[]
}

export function detectPuzzles(
  jobId: string,
  payload: DetectPuzzlesPayload,
): Promise<PuzzlesDetectedResponse> {
  return sendRealtimeRequest<DetectPuzzlesPayload, PuzzlesDetectedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'detect-puzzles',
    responseEvent: 'puzzles-detected',
    jobId,
    payload,
    timeoutMs: TIMEOUTS.detectPuzzles,
  })
}
