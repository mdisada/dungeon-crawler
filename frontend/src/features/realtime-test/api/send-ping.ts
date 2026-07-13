import { sendRealtimeRequest } from '@/lib/realtime-request'
import type { PongPayload } from '../types'

const CHANNEL_TOPIC = 'signal-test'
const TIMEOUT_MS = 10_000

/** Sends a 'ping' broadcast and resolves once the backend replies with the matching 'pong'. */
export function sendPing(jobId: string): Promise<PongPayload> {
  return sendRealtimeRequest<{ sentAt: number }, PongPayload>({
    channelTopic: CHANNEL_TOPIC,
    requestEvent: 'ping',
    responseEvent: 'pong',
    jobId,
    payload: { sentAt: Date.now() },
    timeoutMs: TIMEOUT_MS,
  })
}
