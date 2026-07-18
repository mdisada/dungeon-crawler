import { supabase } from '@/lib/supabase'

export async function deleteCharacter(characterId: string): Promise<void> {
  const { error } = await supabase.from('characters').delete().eq('id', characterId)
  if (error) throw error
}
