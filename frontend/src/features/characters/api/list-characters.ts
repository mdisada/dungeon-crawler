import { supabase } from '@/lib/supabase'
import type { CharacterSummary } from '../types'

interface CharacterSummaryRow {
  id: string
  name: string
  race_key: string | null
  class_key: string | null
  level: number
  is_complete: boolean
  images: { avatarUrl?: string }
}

export async function listCharacters(userId: string): Promise<CharacterSummary[]> {
  const { data, error } = await supabase
    .from('characters')
    .select('id, name, race_key, class_key, level, is_complete, images')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data as CharacterSummaryRow[]).map((row) => ({
    id: row.id,
    name: row.name,
    raceKey: row.race_key,
    classKey: row.class_key,
    level: row.level,
    isComplete: row.is_complete,
    avatarUrl: row.images?.avatarUrl,
  }))
}
