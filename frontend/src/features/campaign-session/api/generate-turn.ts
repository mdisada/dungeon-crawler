import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { TurnDraftedResponse } from '../types'

export function generateTurn(
  jobId: string,
  campaignId: number,
  feedback?: string,
): Promise<TurnDraftedResponse> {
  return sendRealtimeRequest<{ campaignId: number; feedback?: string }, TurnDraftedResponse>({
    channelTopic: TOPICS.generateTurn,
    requestEvent: 'generate-turn',
    responseEvent: 'turn-drafted',
    jobId,
    payload: feedback ? { campaignId, feedback } : { campaignId },
    timeoutMs: TIMEOUTS.generateTurn,
  })
}
