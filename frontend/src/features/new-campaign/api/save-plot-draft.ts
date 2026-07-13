import { sendRealtimeRequest } from '@/lib/realtime-request'
import { CAMPAIGN_BUILDER_TOPIC, TIMEOUTS } from '../constants'
import type { PlotDraftSavedResponse, PlotDraftSource } from '../types'

export type SavePlotDraftPayload = {
  userId: string
  content: string
  source: PlotDraftSource
}

export function savePlotDraft(
  jobId: string,
  payload: SavePlotDraftPayload,
): Promise<PlotDraftSavedResponse> {
  return sendRealtimeRequest<SavePlotDraftPayload, PlotDraftSavedResponse>({
    channelTopic: CAMPAIGN_BUILDER_TOPIC,
    requestEvent: 'save-plot-draft',
    responseEvent: 'plot-draft-saved',
    jobId,
    payload,
    timeoutMs: TIMEOUTS.savePlotDraft,
  })
}
