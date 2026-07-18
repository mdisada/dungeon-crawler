import { abilityModifier, applyAbilityBonuses, hitPointsMaxAtLevelOne } from '@rules/character'
import { supabase } from '@/lib/supabase'
import { CHARACTER_COLUMNS, toCharacter, type CharacterRow } from './character-row'
import type { Character, SrdClass, WizardDraft } from '../types'

// F02 SS3 step 8 (Review & Save). Writes the wizard's raw choices onto the real columns and
// marks the character complete. HP is the only derived value persisted (it's mutable game state
// once play starts); AC/saves/skills stay computed on demand from the stored raw choices - see
// docs/F02-character-page-creator.md SS9 (ruleset portability).
export async function finalizeCharacter(
  characterId: string,
  draft: WizardDraft,
  srdClass: SrdClass,
): Promise<Character> {
  const finalAbilities = applyAbilityBonuses(draft.baseAbilities, draft.abilityBonuses)
  const conModifier = abilityModifier(finalAbilities.con)
  const hpMax = hitPointsMaxAtLevelOne(srdClass.hitDice, conModifier)

  const { data, error } = await supabase
    .from('characters')
    .update({
      draft,
      name: draft.name,
      race_key: draft.raceKey,
      class_key: draft.classKey,
      background_key: draft.backgroundKey,
      alignment: draft.alignment || null,
      abilities: draft.baseAbilities,
      ability_bonuses: draft.abilityBonuses,
      skill_proficiencies: draft.skillProficiencies,
      tool_proficiencies: draft.toolProficiencies,
      equipment: [
        ...(draft.classEquipmentChoice ? [{ source: 'class', choice: draft.classEquipmentChoice }] : []),
        ...(draft.equipmentChoice ? [{ source: 'background', choice: draft.equipmentChoice }] : []),
      ],
      voice: draft.voice,
      hp_max: hpMax,
      hp_current: hpMax,
      personality: draft.personality,
      freeform_text: draft.freeformText,
      physical: draft.physical,
      background_narrative: draft.backgroundNarrative || null,
      images: draft.images,
      is_complete: true,
    })
    .eq('id', characterId)
    .select(CHARACTER_COLUMNS)
    .single()
  if (error) throw error
  return toCharacter(data as unknown as CharacterRow)
}
