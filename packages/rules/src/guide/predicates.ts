// F04 SS4: completion predicates. Objectives complete via structured predicates - atoms are
// `fact` (world-state path), `flag` (quest flags), `event` (event-log query), combined with
// `any`/`all`. This validator is the single source of truth for what a well-formed predicate
// is: the stage 3 parser, the editor's raw-JSON escape hatch, and the F07 evaluator (later)
// all go through it.

import type { Json } from './types.ts'

export interface FactAtom {
  fact: string
  eq?: Json
  in?: Json[]
}

export interface FlagAtom {
  flag: string
  eq: Json
}

export interface EventAtom {
  event: string
}

export type Predicate =
  | FactAtom
  | FlagAtom
  | EventAtom
  | { any: Predicate[] }
  | { all: Predicate[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isJsonScalar(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  )
}

const ATOM_KEYS = ['fact', 'flag', 'event', 'any', 'all'] as const

/**
 * Structural validation. Returns an empty array when `value` is a valid predicate; otherwise
 * one error message per problem, each prefixed with a JSON-path-ish location.
 */
export function validatePredicate(value: unknown, path = '$'): string[] {
  if (!isPlainObject(value)) {
    return [`${path}: a predicate must be an object, got ${value === null ? 'null' : typeof value}`]
  }

  const present = ATOM_KEYS.filter((k) => k in value)
  if (present.length === 0) {
    return [`${path}: must contain exactly one of "fact", "flag", "event", "any", "all"`]
  }
  if (present.length > 1) {
    return [`${path}: contains ${present.map((k) => `"${k}"`).join(' and ')} - exactly one allowed`]
  }

  const kind = present[0]
  const errors: string[] = []

  if (kind === 'any' || kind === 'all') {
    const branches = value[kind]
    if (!Array.isArray(branches) || branches.length === 0) {
      return [`${path}.${kind}: must be a non-empty array of predicates`]
    }
    branches.forEach((branch, i) => {
      errors.push(...validatePredicate(branch, `${path}.${kind}[${i}]`))
    })
    return errors
  }

  if (typeof value[kind] !== 'string' || (value[kind] as string).length === 0) {
    errors.push(`${path}.${kind}: must be a non-empty string`)
  }

  if (kind === 'fact') {
    const hasEq = 'eq' in value
    const hasIn = 'in' in value
    if (hasEq === hasIn) {
      errors.push(`${path}: a fact atom needs exactly one of "eq" or "in"`)
    }
    if (hasEq && !isJsonScalar(value.eq)) {
      errors.push(`${path}.eq: must be a JSON scalar`)
    }
    if (hasIn && (!Array.isArray(value.in) || value.in.length === 0 || !value.in.every(isJsonScalar))) {
      errors.push(`${path}.in: must be a non-empty array of JSON scalars`)
    }
    const extra = Object.keys(value).filter((k) => !['fact', 'eq', 'in'].includes(k))
    if (extra.length > 0) errors.push(`${path}: unknown keys ${extra.map((k) => `"${k}"`).join(', ')}`)
  }

  if (kind === 'flag') {
    if (!('eq' in value)) {
      errors.push(`${path}: a flag atom needs "eq"`)
    } else if (!isJsonScalar(value.eq)) {
      errors.push(`${path}.eq: must be a JSON scalar`)
    }
    const extra = Object.keys(value).filter((k) => !['flag', 'eq'].includes(k))
    if (extra.length > 0) errors.push(`${path}: unknown keys ${extra.map((k) => `"${k}"`).join(', ')}`)
  }

  if (kind === 'event') {
    const extra = Object.keys(value).filter((k) => k !== 'event')
    if (extra.length > 0) errors.push(`${path}: unknown keys ${extra.map((k) => `"${k}"`).join(', ')}`)
  }

  return errors
}

export function isValidPredicate(value: unknown): value is Predicate {
  return validatePredicate(value).length === 0
}

/**
 * Parses raw JSON text from the editor's escape hatch into a predicate, or explains why not
 * (F04 SS7: "invalid raw JSON blocked with error").
 */
export function parsePredicateJson(text: string): { ok: true; predicate: Predicate } | { ok: false; errors: string[] } {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    return { ok: false, errors: [`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`] }
  }
  const errors = validatePredicate(parsed)
  if (errors.length > 0) return { ok: false, errors }
  return { ok: true, predicate: parsed as Predicate }
}
