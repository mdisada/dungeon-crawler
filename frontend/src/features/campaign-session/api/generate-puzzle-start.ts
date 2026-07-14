import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { PuzzleStartDraftedResponse } from '../types'

export function generatePuzzleStart(
  jobId: string,
  campaignId: number,
  puzzleId: number,
): Promise<PuzzleStartDraftedResponse> {
  return sendRealtimeRequest<{ campaignId: number; puzzleId: number }, PuzzleStartDraftedResponse>({
    channelTopic: TOPICS.generatePuzzleStart,
    requestEvent: 'generate-puzzle-start',
    responseEvent: 'puzzle-start-drafted',
    jobId,
    payload: { campaignId, puzzleId },
    timeoutMs: TIMEOUTS.generatePuzzleStart,
  })
}
