// Deterministic predicate evaluation (F08 SS9, F04 SS4): objective completion and beat exit
// conditions evaluate against the world fact base on every story-progress pass - pure lookups,
// never an LLM. Ambiguous atoms (facts nobody has written) simply don't hold; the Adjudicator
// path proposes completions for those.

import type { Predicate } from '../guide/predicates.ts'
import { isValidPredicate } from '../guide/predicates.ts'
import type { Json } from '../state/types.ts'

export interface WorldFacts {
  /** Flat fact paths, e.g. "npc.volgarth.status" -> "dead", "boy_found" -> true. */
  facts: Record<string, Json>
  flags: Record<string, Json>
  /** Marker events already logged, matched by exact tag. */
  events: ReadonlySet<string>
}

function scalarEq(a: Json | undefined, b: Json): boolean {
  return a === b
}

export function evaluatePredicate(predicate: unknown, world: WorldFacts): boolean {
  if (!isValidPredicate(predicate)) return false
  return holds(predicate, world)
}

function holds(p: Predicate, world: WorldFacts): boolean {
  if ('any' in p) return p.any.some((branch) => holds(branch, world))
  if ('all' in p) return p.all.every((branch) => holds(branch, world))
  if ('fact' in p) {
    const value = world.facts[p.fact]
    if (value === undefined) return 'eq' in p && p.eq === false
    if ('eq' in p && p.eq !== undefined) return scalarEq(value, p.eq)
    if ('in' in p && p.in) return p.in.some((candidate) => scalarEq(value, candidate))
    return false
  }
  if ('flag' in p) {
    const value = world.flags[p.flag]
    // An unset flag IS false. Demanding an explicit `false` write made every "has not happened
    // yet" clause permanently unsatisfiable, because nothing writes a flag false - applyMilestones
    // only ever sets atoms true. "Reach Oakhaven" needed {elara_reached_oakhaven: true,
    // eight_days_passed: false} and could therefore never complete by ANY route: authored,
    // rescue, or adjudicated. Live 2026-07-23, it was the one objective still active when the
    // run ended. Deadlines, "the witness is still alive", "the alarm was never raised" - every
    // negative stake in the escort genre needs this reading.
    //
    // Narrow on purpose: only `eq: false` is satisfied by absence. An unset flag still does not
    // equal true, a string, or a number.
    if (value === undefined) return p.eq === false
    return scalarEq(value, p.eq)
  }
  return world.events.has(p.event)
}

export interface MilestoneAtoms {
  /** Flag names the story may safely set true (only `eq: true` flag atoms qualify). */
  flags: string[]
  /** Exact event marker texts. */
  events: string[]
  /** Boolean world-fact paths (only `eq: true` fact atoms - semantically flags). */
  facts: string[]
}

/**
 * Lists the atoms a predicate can be satisfied through - the authored "milestone vocabulary"
 * the full-AI Adjudicator is allowed to recognize as achieved (F14: the LLM only ever picks
 * from authored milestones; it can never invent one). Non-boolean fact atoms (eq scalar / in
 * lists) are excluded: their values are arbitrary and stay DM-override territory.
 */
export function listMilestoneAtoms(predicate: unknown): MilestoneAtoms {
  const flags = new Set<string>()
  const events = new Set<string>()
  const facts = new Set<string>()
  const walk = (node: unknown): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) return
    const p = node as Record<string, unknown>
    if (Array.isArray(p.any)) return p.any.forEach(walk)
    if (Array.isArray(p.all)) return p.all.forEach(walk)
    if (typeof p.flag === 'string' && p.flag && p.eq === true) flags.add(p.flag)
    if (typeof p.event === 'string' && p.event) events.add(p.event)
    if (typeof p.fact === 'string' && p.fact && p.eq === true) facts.add(p.fact)
  }
  walk(predicate)
  return { flags: [...flags], events: [...events], facts: [...facts] }
}
