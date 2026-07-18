import { supabase } from '@/lib/supabase'
import { getCharacter } from './get-character'
import { CHARACTER_COLUMNS, toCharacter, type CharacterRow } from './character-row'
import type { Character } from '../types'

// Note: image URLs are copied by reference, not re-uploaded - the duplicate points at the same
// Storage objects as the original until the user regenerates/re-crops its own portraits.
export async function duplicateCharacter(characterId: string, userId: string): Promise<Character> {
  const source = await getCharacter(characterId)

  const { data, error } = await supabase
    .from('characters')
    .insert({
      user_id: userId,
      name: `${source.name} (Copy)`,
      ruleset: source.ruleset,
      race_key: source.raceKey,
      class_key: source.classKey,
      background_key: source.backgroundKey,
      level: source.level,
      alignment: source.alignment,
      abilities: source.abilities,
      ability_bonuses: source.abilityBonuses,
      skill_proficiencies: source.skillProficiencies,
      tool_proficiencies: source.toolProficiencies,
      equipment: source.equipment,
      hp_max: source.hpMax,
      hp_current: source.hpMax,
      hp_temp: 0,
      personality: source.personality,
      freeform_text: source.freeformText,
      physical: source.physical,
      voice: source.voice,
      background_narrative: source.backgroundNarrative,
      images: source.images,
      draft: source.draft ?? {},
      is_complete: source.isComplete,
    })
    .select(CHARACTER_COLUMNS)
    .single()
  if (error) throw error
  return toCharacter(data as unknown as CharacterRow)
}
