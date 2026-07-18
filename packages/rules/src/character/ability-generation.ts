import { ABILITY_KEYS, type AbilityScores } from './types'

export const STANDARD_ARRAY = [15, 14, 13, 12, 10, 8] as const

// Validates that a Standard Array assignment is a permutation of STANDARD_ARRAY (F02 SS3 step 3:
// "Standard Array prevents duplicates" - duplicates are impossible if every value in the fixed
// array is used exactly once).
export function validateStandardArrayAssignment(scores: AbilityScores): boolean {
  const assigned = ABILITY_KEYS.map((key) => scores[key]).sort((a, b) => a - b)
  const expected = [...STANDARD_ARRAY].sort((a, b) => a - b)
  return assigned.length === expected.length && assigned.every((v, i) => v === expected[i])
}

export const POINT_BUY_BUDGET = 27
export const POINT_BUY_MIN_SCORE = 8
export const POINT_BUY_MAX_SCORE = 15

const POINT_BUY_COST: Record<number, number> = {
  8: 0,
  9: 1,
  10: 2,
  11: 3,
  12: 4,
  13: 5,
  14: 7,
  15: 9,
}

export interface PointBuyValidation {
  valid: boolean
  totalCost: number
  errors: string[]
}

export function validatePointBuy(scores: AbilityScores): PointBuyValidation {
  const errors: string[] = []
  let totalCost = 0

  for (const key of ABILITY_KEYS) {
    const score = scores[key]
    if (score < POINT_BUY_MIN_SCORE || score > POINT_BUY_MAX_SCORE) {
      errors.push(`${key} (${score}) must be between ${POINT_BUY_MIN_SCORE} and ${POINT_BUY_MAX_SCORE}`)
      continue
    }
    totalCost += POINT_BUY_COST[score]
  }

  if (totalCost > POINT_BUY_BUDGET) {
    errors.push(`Total cost ${totalCost} exceeds the ${POINT_BUY_BUDGET}-point budget`)
  }

  return { valid: errors.length === 0, totalCost, errors }
}
