import { supabase } from '@/lib/supabase'

export type GuideTable =
  | 'chapters'
  | 'objectives'
  | 'npcs'
  | 'locations'
  | 'coop_sets'
  | 'ingredients'
  | 'encounters'
  | 'endings'

/**
 * Row-level autosave (F04 SS6). Every user edit marks the row human_edited so pipeline
 * regeneration proposes instead of overwriting (SS7).
 */
export async function saveGuideRow(
  table: GuideTable,
  id: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ ...patch, human_edited: true, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

/** Accept a regeneration proposal: apply the proposed fields and clear it. */
export async function acceptRegen(
  table: GuideTable,
  id: string,
  pendingRegen: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase
    .from(table)
    .update({ ...pendingRegen, pending_regen: null, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (error) throw error
}

export async function rejectRegen(table: GuideTable, id: string): Promise<void> {
  const { error } = await supabase.from(table).update({ pending_regen: null }).eq('id', id)
  if (error) throw error
}

export async function deleteGuideRow(table: GuideTable, id: string): Promise<void> {
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) throw error
}

export async function insertGuideRow(
  table: GuideTable,
  row: Record<string, unknown>,
): Promise<string> {
  const { data, error } = await supabase.from(table).insert(row).select('id').single()
  if (error) throw error
  return data.id
}
