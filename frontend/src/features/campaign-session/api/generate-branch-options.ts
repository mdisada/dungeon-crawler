import { sendRealtimeRequest } from '@/lib/realtime-request'
import { TIMEOUTS, TOPICS } from '../constants'
import type { BranchOptionsResponse } from '../types'

export function generateBranchOptions(jobId: string, campaignId: number): Promise<BranchOptionsResponse> {
  return sendRealtimeRequest<{ campaignId: number }, BranchOptionsResponse>({
    channelTopic: TOPICS.generateBranchOptions,
    requestEvent: 'generate-branch-options',
    responseEvent: 'branch-options-generated',
    jobId,
    payload: { campaignId },
    timeoutMs: TIMEOUTS.generateBranchOptions,
  })
}
