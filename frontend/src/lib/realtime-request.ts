import { supabase } from '@/lib/supabase'

type SendRealtimeRequestArgs<TReq extends object> = {
  channelTopic: string
  requestEvent: string
  responseEvent: string
  jobId: string
  payload: TReq
  timeoutMs: number
}

export function sendRealtimeRequest<TReq extends object, TRes extends { jobId: string; error?: string }>({
  channelTopic,
  requestEvent,
  responseEvent,
  jobId,
  payload,
  timeoutMs,
}: SendRealtimeRequestArgs<TReq>): Promise<TRes> {
  return new Promise((resolve, reject) => {
    // A Supabase client can't have two channels subscribed on the same topic — the second
    // silently never subscribes. React StrictMode (dev) double-mounts effects, and requests
    // that share a topic can otherwise overlap, so tear down any stale channel on this topic
    // before opening a fresh one.
    supabase
      .getChannels()
      .filter((c) => c.topic === channelTopic || c.topic === `realtime:${channelTopic}`)
      .forEach((c) => supabase.removeChannel(c))

    const channel = supabase.channel(channelTopic)
    const timeout = setTimeout(() => {
      supabase.removeChannel(channel)
      reject(new Error(`Timed out waiting for '${responseEvent}' — is the backend listener running?`))
    }, timeoutMs)

    channel
      .on('broadcast', { event: responseEvent }, ({ payload: response }) => {
        const typedResponse = response as TRes
        if (typedResponse.jobId !== jobId) return
        clearTimeout(timeout)
        supabase.removeChannel(channel)
        if (typedResponse.error) {
          reject(new Error(typedResponse.error))
        } else {
          resolve(typedResponse)
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          channel.send({ type: 'broadcast', event: requestEvent, payload: { ...payload, jobId } })
        }
      })
  })
}
