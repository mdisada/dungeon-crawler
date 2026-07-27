import { supabase } from '@/lib/supabase'

import type { LabRun, LabRunConfig, ReusableAdventure } from '../types'

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
