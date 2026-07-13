import { supabase } from '@/lib/supabase'
import type { Note } from '../types'

export async function getNotes(): Promise<Note[]> {
  const { data, error } = await supabase.from('notes').select()
  if (error) throw new Error(error.message)
  return data
}
