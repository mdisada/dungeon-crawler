import { supabase } from '@/lib/supabase'
import { FALLBACK_CORE_TRAITS } from '../lib/fallback-core-traits'
import { parseCoreTraitsTable } from '../lib/parse-core-traits'
import type { SrdClass } from '../types'

interface SrdClassFeatureData {
  name: string
  desc?: string
}

interface SrdClassRow {
  key: string
  name: string
  hit_dice: string
  data: {
    saving_throws?: (string | { name: string })[]
    features?: SrdClassFeatureData[]
  }
}

function toSrdClass(row: SrdClassRow): SrdClass {
  const savingThrows = (row.data.saving_throws ?? []).map((s) => (typeof s === 'string' ? s : s.name))
  const coreTraitsFeature = row.data.features?.find((f) => f.name === `Core ${row.name} Traits`)
  const parsed = coreTraitsFeature?.desc
    ? parseCoreTraitsTable(coreTraitsFeature.desc)
    : (FALLBACK_CORE_TRAITS[row.key] ?? parseCoreTraitsTable(undefined))
  return {
    key: row.key,
    name: row.name,
    hitDice: row.hit_dice,
    savingThrows,
    skillChoiceCount: parsed.skillChoiceCount,
    skillChoices: parsed.skillChoices,
    equipmentOptions: parsed.equipmentOptions,
    traitsTable: parsed.table,
  }
}

// Base classes only (no subclasses) - v1 is single-class, level-1 start (F02 SS8).
export async function listSrdClasses(): Promise<SrdClass[]> {
  const { data, error } = await supabase
    .from('srd_classes')
    .select('key, name, hit_dice, data')
    .is('subclass_of', null)
    .order('name')
  if (error) throw error
  return (data as SrdClassRow[]).map(toSrdClass)
}
