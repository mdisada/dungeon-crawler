import { supabase } from '@/lib/supabase'
import type { AbilityKey, SrdBackground } from '../types'

interface SrdBackgroundRow {
  key: string
  name: string
  ability_options: string[]
  skill_proficiencies: string[]
  tool_proficiency: { desc: string } | null
  feat: string | null
  equipment: { desc: string } | null
}

const ABILITY_NAME_TO_KEY: Record<string, AbilityKey> = {
  Strength: 'str',
  Dexterity: 'dex',
  Constitution: 'con',
  Intelligence: 'int',
  Wisdom: 'wis',
  Charisma: 'cha',
}

function toSrdBackground(row: SrdBackgroundRow): SrdBackground {
  return {
    key: row.key,
    name: row.name,
    abilityOptions: row.ability_options
      .map((name) => ABILITY_NAME_TO_KEY[name])
      .filter((key): key is AbilityKey => key !== undefined),
    skillProficiencies: row.skill_proficiencies,
    toolProficiency: row.tool_proficiency?.desc ?? null,
    feat: row.feat,
    equipmentDesc: row.equipment?.desc ?? null,
  }
}

export async function listSrdBackgrounds(): Promise<SrdBackground[]> {
  const { data, error } = await supabase
    .from('srd_backgrounds')
    .select('key, name, ability_options, skill_proficiencies, tool_proficiency, feat, equipment')
    .order('name')
  if (error) throw error
  return (data as SrdBackgroundRow[]).map(toSrdBackground)
}
