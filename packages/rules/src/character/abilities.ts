import { ABILITY_KEYS, type AbilityKey, type AbilityScores, type Ruleset } from './types'

export function abilityModifier(score: number): number {
  return Math.floor((score - 10) / 2)
}

// Adds the chosen ASI assignment on top of base scores. `bonuses` is a partial map (only
// abilities that received a bonus need an entry); missing entries are treated as +0.
export function applyAbilityBonuses(
  base: AbilityScores,
  bonuses: Partial<Record<AbilityKey, number>>,
): AbilityScores {
  const result = {} as AbilityScores
  for (const key of ABILITY_KEYS) {
    result[key] = base[key] + (bonuses[key] ?? 0)
  }
  return result
}

export interface AbilityBonusValidation {
  valid: boolean
  errors: string[]
}

// Validates a background-granted ASI assignment (srd-5.2.1: F02 SS3 step 4). The background
// lists 3 eligible abilities; the player assigns either +2/+1 to two distinct eligible abilities,
// or +1/+1/+1 to all three. Other rulesets (not yet implemented) may source ASIs differently -
// this function is deliberately named for the 5.2.1 shape rather than a generic "apply bonuses".
export function validateAbilityBonusAssignment(
  bonuses: Partial<Record<AbilityKey, number>>,
  eligibleAbilities: readonly AbilityKey[],
  ruleset: Ruleset = 'srd-5.2.1',
): AbilityBonusValidation {
  if (ruleset !== 'srd-5.2.1') {
    return { valid: false, errors: [`Unsupported ruleset: ${ruleset}`] }
  }

  const errors: string[] = []
  const entries = Object.entries(bonuses).filter(
    (entry): entry is [AbilityKey, number] => (entry[1] ?? 0) !== 0,
  )

  for (const [key] of entries) {
    if (!eligibleAbilities.includes(key)) {
      errors.push(`${key} is not one of this background's eligible abilities`)
    }
  }

  const values = entries.map(([, value]) => value).sort((a, b) => b - a)
  const isTwoOneSplit = values.length === 2 && values[0] === 2 && values[1] === 1
  const isOneOneOneSplit = values.length === 3 && values.every((v) => v === 1)

  if (!isTwoOneSplit && !isOneOneOneSplit) {
    errors.push('Assignment must be +2/+1 to two abilities or +1/+1/+1 to three abilities')
  }

  return { valid: errors.length === 0, errors }
}
