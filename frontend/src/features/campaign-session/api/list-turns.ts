import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { TurnsListedResponse } from '../types'

export function listTurns(jobId: string, campaignId: number): Promise<TurnsListedResponse> {
  return sendRealtimeRequest<{ campaignId: number }, TurnsListedResponse>({
    channelTopic: TOPICS.listTurns,
    requestEvent: 'list-turns',
    responseEvent: 'turns-listed',
    jobId,
    payload: { campaignId },
    timeoutMs: TIMEOUTS.listTurns,
  })
}
