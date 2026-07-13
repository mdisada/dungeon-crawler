import { supabase } from '@/lib/supabase'
import type { PongPayload } from '../types'

const CHANNEL_TOPIC = 'signal-test'
const TIMEOUT_MS = 10_000

/** Sends a 'ping' broadcast and resolves once the backend replies with the matching 'pong'. */
export function sendPing(jobId: string): Promise<PongPayload> {
  return new Promise((resolve, reject) => {
    const channel = supabase.channel(CHANNEL_TOPIC)

    const timeout = setTimeout(() => {
      supabase.removeChannel(channel)
      reject(new Error('Timed out waiting for pong — is the backend listener running?'))
    }, TIMEOUT_MS)

    channel
      .on('broadcast', { event: 'pong' }, ({ payload }) => {
        if (payload.jobId !== jobId) return
        clearTimeout(timeout)
        supabase.removeChannel(channel)
        resolve(payload as PongPayload)
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({
            type: 'broadcast',
            event: 'ping',
            payload: { jobId, sentAt: Date.now() },
          })
        }
      })
  })
}
