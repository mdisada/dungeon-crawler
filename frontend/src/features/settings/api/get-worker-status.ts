import { supabase } from '@/lib/supabase'
import type { WorkerStatus } from '../types'

export async function getWorkerStatus(userId: string): Promise<WorkerStatus> {
  const { data, error } = await supabase
    .from('worker_status')
    .select('last_heartbeat_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  return { lastHeartbeatAt: data?.last_heartbeat_at ?? null }
}
