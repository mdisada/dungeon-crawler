import { supabase } from '@/lib/supabase'

export async function deleteAdventure(adventureId: string): Promise<void> {
  const { error } = await supabase.from('adventures').delete().eq('id', adventureId)
  if (error) throw error
}
