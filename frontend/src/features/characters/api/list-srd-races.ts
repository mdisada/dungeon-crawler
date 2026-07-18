import { supabase } from '@/lib/supabase'
import type { SrdRace } from '../types'

interface SrdRaceRow {
  key: string
  name: string
  size: string | null
  speed: string | null
  traits: { name: string; desc: string }[]
}

export async function listSrdRaces(): Promise<SrdRace[]> {
  const { data, error } = await supabase
    .from('srd_races')
    .select('key, name, size, speed, traits')
    .order('name')
  if (error) throw error
  return (data as SrdRaceRow[]).map((row) => ({
    key: row.key,
    name: row.name,
    size: row.size,
    speed: row.speed,
    traits: row.traits,
  }))
}
