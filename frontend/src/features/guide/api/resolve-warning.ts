import { supabase } from '@/lib/supabase'

/**
 * Mark a guide warning handled (the review popup's Approve/Edit both call this). A stage rerun
 * deletes its own warnings and writes fresh rows, so acknowledgements reset naturally when the
 * content actually changes.
 */
export async function resolveWarning(id: string): Promise<void> {
  const { error } = await supabase.from('guide_warnings').update({ resolved: true }).eq('id', id)
  if (error) throw error
}

/** Approve-all: one click, one request, the whole queue. */
export async function resolveWarnings(ids: string[]): Promise<void> {
  if (ids.length === 0) return
  const { error } = await supabase.from('guide_warnings').update({ resolved: true }).in('id', ids)
  if (error) throw error
}
