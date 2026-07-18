import { supabase } from '@/lib/supabase'
import type { SrdFeat } from '../types'

interface SrdFeatRow {
  key: string
  name: string
  feat_type: string | null
  description: string | null
  benefits: { desc: string }[]
}

export async function listSrdFeats(): Promise<SrdFeat[]> {
  const { data, error } = await supabase
    .from('srd_feats')
    .select('key, name, feat_type, description, benefits')
    .order('name')
  if (error) throw error
  return (data as SrdFeatRow[]).map((row) => ({
    key: row.key,
    name: row.name,
    featType: row.feat_type,
    description: row.description,
    benefits: row.benefits,
  }))
}
