import { supabase } from '@/lib/supabase'
import { ADVENTURE_COLUMNS, toAdventure, type AdventureRow } from './adventure-row'
import type { Adventure } from '../types'

export async function getAdventure(adventureId: string): Promise<Adventure> {
  const { data, error } = await supabase
    .from('adventures')
    .select(ADVENTURE_COLUMNS)
    .eq('id', adventureId)
    .single()
  if (error) throw error
  return toAdventure(data as unknown as AdventureRow)
}
