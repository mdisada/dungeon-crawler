import { supabase } from '@/lib/supabase'

/**
 * Passively subscribes to a broadcast event on a topic and calls onMessage for every message —
 * for server-pushed updates with no request/response pairing (unlike sendRealtimeRequest, which
 * owns a topic for the lifetime of one request). Keep this on its own topic, separate from any
 * topic sendRealtimeRequest also uses, since that helper tears down every channel on a topic
 * before opening its own — it would otherwise kill this subscription too.
 */
export function subscribeToBroadcast<T>(
  channelTopic: string,
  event: string,
  onMessage: (payload: T) => void,
): () => void {
  const channel = supabase
    .channel(channelTopic)
    .on('broadcast', { event }, ({ payload }) => onMessage(payload as T))
    .subscribe()

  return () => {
    supabase.removeChannel(channel)
  }
}
