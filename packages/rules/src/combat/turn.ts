// Interactive combat across requests (F09, 2026-08-01).
//
// The headless resolver ran a whole fight inside one call: one seeded stream, `runAutoTurn` looped
// to completion, and the engine state discarded on return. A fight the table PLAYS is the opposite
// shape - it lives between requests, and each request advances it by exactly one player decision
// plus whatever the AI does in answer.
//
// Two things that were implicit in the headless loop have to become explicit here:
//
//  1. The dice. A seeded Rng carries its cursor in a closure, which does not survive serialization,
//     so the fight cannot share one stream. Each action derives its own from (seed, step) and the
//     step counter is persisted - which keeps the whole fight replayable from the seed and the list
//     of actions, exactly as the headless path was replayable from the seed alone.
//  2. Whose turn it is. `runAutoTurn` drives whoever is active regardless of their `auto` flag -
//     correct when nobody is watching, wrong now: it would play the party's turns for them.
//     `runAiTurns` stops the moment a human-controlled combatant is up.
//
// Pure, like the rest of the engine: no session, no Supabase, testable on fixtures.

import { seededRng } from '../play/rng.ts'
import type { Rng } from '../play/rng.ts'
import { activeCombatant } from './engine.ts'
import { runAutoTurn } from './heuristic.ts'
import { fightIsOver } from './manifest.ts'
import type { CombatEngineState, CombatEvent } from './types.ts'

/**
 * The rng for one action of a fight. Deterministic in both arguments, and distinct for adjacent
 * steps - seeding straight off `seed + step` would give near-identical mulberry32 streams for
 * consecutive turns, which is the one way this could be worse than a shared stream.
 */
export function stepRng(seed: number, step: number): Rng {
  return seededRng((Math.imul(seed >>> 0, 0x9e3779b1) ^ Math.imul(step + 1, 0x85ebca6b)) >>> 0)
}

/**
 * Backstop for a heuristic that never yields the turn. Matched to the headless resolver's
 * RESOLVE_TURN_CAP, because the worst case here is the same one: once every human-controlled PC is
 * unconscious, the remaining party fights on under `auto` and this loop runs the REST of the battle
 * in a single call, exactly as the headless path did.
 */
const AI_TURN_CAP = 1000

export interface AiTurnsResult {
  state: CombatEngineState
  events: CombatEvent[]
  /** The step counter after the AI turns - the caller persists it. */
  step: number
}

/**
 * Play out every consecutive AI turn from here, stopping at the first human-controlled combatant
 * (or the end of the fight). Called after a player's action so the answer to "what did the goblins
 * do?" is already in the state the client receives, rather than needing another round trip.
 */
export function runAiTurns(
  engine: CombatEngineState,
  seed: number,
  step: number,
  bossRef: string | null,
): AiTurnsResult {
  let state = engine
  let cursor = step
  const events: CombatEvent[] = []
  for (let i = 0; i < AI_TURN_CAP; i++) {
    if (fightIsOver(state, bossRef)) break
    if (!activeCombatant(state).auto) break
    const result = runAutoTurn(state, stepRng(seed, cursor))
    cursor += 1
    state = result.state
    events.push(...result.events)
  }
  return { state, events, step: cursor }
}

/** True when the fight is waiting on a person - what makes it worth persisting instead of looping. */
export function awaitsPlayer(engine: CombatEngineState, bossRef: string | null): boolean {
  return !fightIsOver(engine, bossRef) && !activeCombatant(engine).auto
}
