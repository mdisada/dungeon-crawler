import { supabase } from '@/lib/supabase'
import { CHARACTER_COLUMNS, toCharacter, type CharacterRow } from './character-row'
import type { Character } from '../types'

export async function getCharacter(characterId: string): Promise<Character> {
  const { data, error } = await supabase
    .from('characters')
    .select(CHARACTER_COLUMNS)
    .eq('id', characterId)
    .single()
  if (error) throw error
  return toCharacter(data as unknown as CharacterRow)
}
