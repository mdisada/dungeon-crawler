import type { AbilityKey, AbilityScores, Ruleset } from '@rules/character'

export type { AbilityKey, AbilityScores, Ruleset }

export interface SrdRace {
  key: string
  name: string
  size: string | null
  speed: string | null
  traits: { name: string; desc: string; type?: string | null }[]
}

export interface EquipmentOption {
  letter: string
  desc: string
}

export interface SrdClass {
  key: string
  name: string
  hitDice: string
  savingThrows: string[]
  // Parsed from the class's "Core <Class> Traits" markdown table (with a hardcoded fallback for
  // classes missing that feature in the seeded SRD data - see lib/fallback-core-traits.ts).
  skillChoiceCount: number
  skillChoices: string[]
  equipmentOptions: EquipmentOption[]
  // Remaining Core Traits rows (Primary Ability, Weapon Proficiencies, Armor Training, ...) for
  // read-only display.
  traitsTable: Record<string, string>
}

export interface SrdBackground {
  key: string
  name: string
  abilityOptions: AbilityKey[]
  skillProficiencies: string[]
  toolProficiency: string | null
  feat: string | null
  equipmentDesc: string | null
}

export interface SrdFeat {
  key: string
  name: string
  featType: string | null
  description: string | null
  benefits: { desc: string }[]
}

export type AbilityMethod = 'standard_array' | 'point_buy' | 'manual'

export interface Personality {
  traits: string
  ideals: string
  bonds: string
  flaws: string
}

export interface Physical {
  age: string
  height: string
  hair: string
  eyes: string
  description: string
}

export interface CharacterVoice {
  source: 'default' | 'clip'
  clipPath?: string
}

export interface CharacterImages {
  fullbodyUrl?: string
  avatarUrl?: string
  tokenUrl?: string
  portraitUrl?: string
}

export const WIZARD_STEPS = [
  'race',
  'class',
  'abilities',
  'background',
  'equipment',
  'personality',
  'portrait',
  'review',
] as const

export type WizardStep = (typeof WIZARD_STEPS)[number]

// The full working state of an in-progress wizard, persisted to characters.draft (jsonb) after
// every step so it survives reload/device switches (F02 SS3).
export interface WizardDraft {
  step: WizardStep
  name: string
  raceKey: string | null
  classKey: string | null
  abilityMethod: AbilityMethod
  baseAbilities: AbilityScores
  backgroundKey: string | null
  abilityBonuses: Partial<Record<AbilityKey, number>>
  skillProficiencies: string[]
  toolProficiencies: string[]
  classEquipmentChoice: string | null
  equipmentChoice: string | null
  alignment: string
  personality: Personality
  freeformText: string
  physical: Physical
  voice: CharacterVoice
  images: CharacterImages
  backgroundNarrative: string
}

export interface Character {
  id: string
  userId: string
  name: string
  ruleset: Ruleset
  raceKey: string | null
  classKey: string | null
  backgroundKey: string | null
  level: number
  alignment: string | null
  abilities: AbilityScores
  abilityBonuses: Partial<Record<AbilityKey, number>>
  skillProficiencies: string[]
  toolProficiencies: string[]
  equipment: unknown[]
  hpMax: number | null
  hpCurrent: number | null
  hpTemp: number
  xp: number
  personality: Personality
  freeformText: string
  physical: Physical
  voice: CharacterVoice
  backgroundNarrative: string | null
  images: CharacterImages
  persistentConditions: unknown[]
  draft: WizardDraft | null
  isComplete: boolean
  createdAt: string
  updatedAt: string
}

export interface CharacterSummary {
  id: string
  name: string
  raceKey: string | null
  classKey: string | null
  level: number
  isComplete: boolean
  avatarUrl?: string
}
