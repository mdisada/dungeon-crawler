import { supabase } from '@/lib/supabase'
import type { LabComment, LabRun, LabRunConfig, LabRunEvent, ReusableAdventure } from '../types'

export async function listRuns(): Promise<LabRun[]> {
  const { data, error } = await supabase
    .from('lab_runs')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) throw error
  return (data ?? []) as LabRun[]
}

export async function createRun(userId: string, config: LabRunConfig): Promise<LabRun> {
  const { data, error } = await supabase
    .from('lab_runs')
    .insert({ created_by: userId, config })
    .select('*')
    .single()
  if (error) throw error
  return data as LabRun
}

export async function cancelRun(runId: string): Promise<void> {
  const { error } = await supabase
    .from('lab_runs')
    .update({ status: 'cancelled' })
    .eq('id', runId)
    .in('status', ['queued', 'running'])
  if (error) throw error
}

/** Incremental tail: only rows after `sinceId`, so the poll stays cheap on long runs. */
export async function listEventsSince(runId: string, sinceId: number): Promise<LabRunEvent[]> {
  const { data, error } = await supabase
    .from('lab_run_events')
    .select('*')
    .eq('run_id', runId)
    .gt('id', sinceId)
    .order('id')
    .limit(500)
  if (error) throw error
  return (data ?? []) as LabRunEvent[]
}

export async function listComments(runId: string): Promise<LabComment[]> {
  const { data, error } = await supabase
    .from('lab_comments')
    .select('id, run_id, event_id, body, created_at')
    .eq('run_id', runId)
    .order('created_at')
  if (error) throw error
  return (data ?? []) as LabComment[]
}

export async function addComment(
  userId: string, runId: string, body: string, eventId: number | null,
): Promise<LabComment> {
  const { data, error } = await supabase
    .from('lab_comments')
    .insert({ author_id: userId, run_id: runId, event_id: eventId, body })
    .select('id, run_id, event_id, body, created_at')
    .single()
  if (error) throw error
  return data as LabComment
}

/** Adventures earlier lab runs generated - replayable without paying for generation again. */
export async function listReusableAdventures(): Promise<ReusableAdventure[]> {
  const { data, error } = await supabase
    .from('lab_runs')
    .select('adventure_id, adventures(title, status)')
    .not('adventure_id', 'is', null)
    .eq('status', 'done')
  if (error) throw error
  const seen = new Set<string>()
  const out: ReusableAdventure[] = []
  type Row = { adventure_id: string; adventures: { title: string | null; status: string } | null }
  for (const row of (data ?? []) as unknown as Row[]) {
    // Without generated DB types the client can't tell a to-one embed from to-many.
    const adventure = Array.isArray(row.adventures) ? row.adventures[0] : row.adventures
    if (!adventure || adventure.status !== 'guide_ready' || seen.has(row.adventure_id)) continue
    seen.add(row.adventure_id)
    out.push({ adventureId: row.adventure_id, title: adventure.title ?? row.adventure_id.slice(0, 8) })
  }
  return out
}
