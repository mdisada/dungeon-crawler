// Beat Planner boundary parser (F08 SS4): one beat only, goals phrased as situations, exit
// conditions in the same predicate atoms as F04, braided pairs gated on the composition
// profile (emitted only when the party can actually resolve both halves).

import { validatePredicate } from '../guide/predicates.ts'
import type { Json } from '../state/types.ts'

export interface IngredientRequest {
  type: 'clue' | 'secret' | 'event' | 'item' | 'rumor'
  purpose: string
  pillarTags: string[]
}

export interface BraidedPair {
  goalPair: [number, number]
  link: { kind: 'dc_mod' }
  /** Skills the two halves lean on - both must exist in the party for the pair to survive. */
  skills: [string, string]
}

export interface BeatPlan {
  name: string
  goals: string[]
  exitConditions: Json
  ingredientRequests: IngredientRequest[]
  braided: BraidedPair[]
  narrationSeed: string
}

export interface BeatPlanContext {
  partySize: number
  partySkills: string[]
}

const INGREDIENT_TYPES = ['clue', 'secret', 'event', 'item', 'rumor'] as const
const PILLARS = new Set(['combat', 'social', 'exploration'])

export type BeatParseResult =
  | { ok: true; plan: BeatPlan; dropped: string[] }
  | { ok: false; errors: string[] }

/**
 * Braided pairs degrade softly (dropped + noted) - a beat with a bad pair is still a beat.
 * Everything else that fails validation is a hard error so the planner retries.
 */
export function parseBeatPlan(raw: unknown, ctx: BeatPlanContext): BeatParseResult {
  const errors: string[] = []
  const dropped: string[] = []
  if (typeof raw !== 'object' || raw === null) return { ok: false, errors: ['beat plan is not an object'] }
  const obj = raw as Record<string, unknown>
  const beat = (typeof obj.beat === 'object' && obj.beat !== null ? obj.beat : obj) as Record<string, unknown>

  const name = typeof beat.name === 'string' && beat.name.trim() ? beat.name.trim() : ''
  if (!name) errors.push('beat.name: expected a non-empty string')

  const goalsRaw = Array.isArray(beat.goals) ? beat.goals : []
  const goals = goalsRaw.filter((g): g is string => typeof g === 'string' && g.trim().length > 0).slice(0, 4)
  if (goals.length === 0) errors.push('beat.goals: expected 1-4 player-facing situations')

  let exitConditions: Json = null
  if (beat.exit_conditions != null) {
    const problems = validatePredicate(beat.exit_conditions)
    if (problems.length > 0) errors.push(...problems.map((p) => `beat.exit_conditions: ${p}`))
    else exitConditions = beat.exit_conditions as Json
  }

  const ingredientRequests: IngredientRequest[] = (Array.isArray(beat.ingredient_requests) ? beat.ingredient_requests : [])
    .slice(0, 5)
    .flatMap((r) => {
      if (typeof r !== 'object' || r === null) return []
      const req = r as Record<string, unknown>
      const type = INGREDIENT_TYPES.find((t) => t === req.type)
      if (!type || typeof req.purpose !== 'string' || !req.purpose.trim()) return []
      const pillarTags = Array.isArray(req.pillar_tags)
        ? req.pillar_tags.filter((p): p is string => typeof p === 'string' && PILLARS.has(p))
        : []
      return [{ type, purpose: req.purpose.trim(), pillarTags }]
    })

  const partySkills = new Set(ctx.partySkills.map((s) => s.toLowerCase()))
  const braided: BraidedPair[] = []
  for (const b of Array.isArray(beat.braided) ? beat.braided : []) {
    if (typeof b !== 'object' || b === null) continue
    const pair = b as Record<string, unknown>
    const goalPair = Array.isArray(pair.goal_pair) ? pair.goal_pair.map(Number) : []
    const skills = Array.isArray(pair.skills) ? pair.skills.filter((s): s is string => typeof s === 'string') : []
    if (goalPair.length !== 2 || goalPair.some((i) => !Number.isInteger(i) || i < 0 || i >= goals.length) || goalPair[0] === goalPair[1]) {
      dropped.push('braided pair with invalid goal indexes')
      continue
    }
    if (ctx.partySize < 2) {
      dropped.push('braided pair (solo party)')
      continue
    }
    if (skills.length !== 2 || skills.some((s) => !partySkills.has(s.toLowerCase()))) {
      dropped.push(`braided pair needing skills the party lacks (${skills.join(', ') || 'unspecified'})`)
      continue
    }
    braided.push({ goalPair: [goalPair[0], goalPair[1]], link: { kind: 'dc_mod' }, skills: [skills[0], skills[1]] })
  }

  const narrationSeed = typeof beat.narration_seed === 'string' && beat.narration_seed.trim()
    ? beat.narration_seed.trim()
    : ''
  if (!narrationSeed) errors.push('beat.narration_seed: expected a non-empty string')

  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, plan: { name, goals, exitConditions, ingredientRequests, braided, narrationSeed }, dropped }
}
