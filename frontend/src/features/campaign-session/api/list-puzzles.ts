import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { PuzzlesListedResponse } from '../types'

export function listPuzzles(jobId: string, campaignId: number): Promise<PuzzlesListedResponse> {
  return sendRealtimeRequest<{ campaignId: number }, PuzzlesListedResponse>({
    channelTopic: TOPICS.listPuzzles,
    requestEvent: 'list-puzzles',
    responseEvent: 'puzzles-listed',
    jobId,
    payload: { campaignId },
    timeoutMs: TIMEOUTS.listPuzzles,
  })
}
