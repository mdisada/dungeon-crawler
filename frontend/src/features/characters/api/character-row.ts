import type { AbilityKey, AbilityScores, Character, Ruleset, WizardDraft } from '../types'

// Shared row shape + mapper for characters.* CRUD calls (list/get/create/update all select the
// same columns and map through this).
export interface CharacterRow {
  id: string
  user_id: string
  name: string
  ruleset: string
  race_key: string | null
  class_key: string | null
  background_key: string | null
  level: number
  alignment: string | null
  abilities: AbilityScores
  ability_bonuses: Partial<Record<AbilityKey, number>>
  skill_proficiencies: string[]
  tool_proficiencies: string[]
  equipment: unknown[]
  hp_max: number | null
  hp_current: number | null
  hp_temp: number
  xp: number
  personality: Character['personality']
  freeform_text: string
  physical: Character['physical']
  voice: Character['voice'] | Record<string, never>
  background_narrative: string | null
  images: Character['images']
  persistent_conditions: unknown[]
  draft: WizardDraft | Record<string, never>
  is_complete: boolean
  created_at: string
  updated_at: string
}

export const CHARACTER_COLUMNS =
  'id, user_id, name, ruleset, race_key, class_key, background_key, level, alignment, abilities, ' +
  'ability_bonuses, skill_proficiencies, tool_proficiencies, equipment, hp_max, hp_current, hp_temp, ' +
  'xp, personality, freeform_text, physical, voice, background_narrative, images, persistent_conditions, ' +
  'draft, is_complete, created_at, updated_at'

export function toCharacter(row: CharacterRow): Character {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    ruleset: row.ruleset as Ruleset,
    raceKey: row.race_key,
    classKey: row.class_key,
    backgroundKey: row.background_key,
    level: row.level,
    alignment: row.alignment,
    abilities: row.abilities,
    abilityBonuses: row.ability_bonuses,
    skillProficiencies: row.skill_proficiencies,
    toolProficiencies: row.tool_proficiencies,
    equipment: row.equipment,
    hpMax: row.hp_max,
    hpCurrent: row.hp_current,
    hpTemp: row.hp_temp,
    xp: row.xp,
    personality: row.personality,
    freeformText: row.freeform_text,
    physical: row.physical,
    voice: 'source' in row.voice ? (row.voice as Character['voice']) : { source: 'default' },
    backgroundNarrative: row.background_narrative,
    images: row.images,
    persistentConditions: row.persistent_conditions,
    draft: 'step' in row.draft ? (row.draft as WizardDraft) : null,
    isComplete: row.is_complete,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
