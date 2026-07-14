import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { PublishTurnPayload, TurnAuthor, TurnPublishedAckResponse } from '../types'

export function publishTurn(
  jobId: string,
  campaignId: number,
  content: string,
  author: TurnAuthor,
  puzzleId?: number,
): Promise<TurnPublishedAckResponse> {
  return sendRealtimeRequest<PublishTurnPayload, TurnPublishedAckResponse>({
    channelTopic: TOPICS.publishTurn,
    requestEvent: 'publish-turn',
    responseEvent: 'turn-published-ack',
    jobId,
    payload: puzzleId !== undefined ? { campaignId, content, author, puzzleId } : { campaignId, content, author },
    timeoutMs: TIMEOUTS.publishTurn,
  })
}
