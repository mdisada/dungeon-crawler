import { supabase } from '@/lib/supabase'
import { ADVENTURE_COLUMNS, toAdventure, type AdventureRow } from './adventure-row'
import type { Adventure } from '../types'

// /adventures/new resumes the user's most recent draft rather than inserting a fresh row per
// visit, so reload restores all fields (F03 SS2 autosave + acceptance criterion 1) without
// littering abandoned rows. Once a draft moves to status 'generating' the next visit starts a
// new one.
export async function getOrCreateAdventureDraft(userId: string): Promise<Adventure> {
  const { data, error } = await supabase
    .from('adventures')
    .select(ADVENTURE_COLUMNS)
    .eq('creator_id', userId)
    .eq('status', 'draft')
    .order('updated_at', { ascending: false })
    .limit(1)
  if (error) throw error
  if (data.length > 0) return toAdventure(data[0] as unknown as AdventureRow)

  const inserted = await supabase
    .from('adventures')
    .insert({ creator_id: userId })
    .select(ADVENTURE_COLUMNS)
    .single()
  if (inserted.error) throw inserted.error
  return toAdventure(inserted.data as unknown as AdventureRow)
}
