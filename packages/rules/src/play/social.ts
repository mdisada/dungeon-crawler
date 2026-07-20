// Social rules (F10): disposition model, social openings, reveal gating, and NPC willingness.
// Everything here is a server-side guardrail - the NPC Agent proposes, these functions decide.

import type { NpcProposedAction, OpeningView, RevealCandidate } from './types.ts'

export const DISPOSITION_MIN = -10
export const DISPOSITION_MAX = 10
export const DELTA_MIN = -2
export const DELTA_MAX = 2

export function clampDisposition(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(DISPOSITION_MAX, Math.max(DISPOSITION_MIN, Math.round(value)))
}

export function clampDispositionDelta(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.min(DELTA_MAX, Math.max(DELTA_MIN, Math.round(value)))
}

/** Total signed disposition movement one scene may produce before a PC has to earn more. */
export const SCENE_DISPOSITION_DRIFT_MAX = 4

/** What, concretely, happened on this turn - a delta needs at least one of these. */
export interface DispositionTrigger {
  /** An influence/insight check resolved with this utterance. */
  checkResolved: boolean
  /** The NPC actually gave something up. */
  revealed: boolean
  /** The NPC offered a gift, joined, left - something with teeth. */
  proposedAction: boolean
}

/**
 * Disposition used to ratchet: the agent returned +1 on every line, so a PC who simply kept
 * talking bought their way to devoted. Plain conversation carrying no concrete trigger now
 * moves nothing; checked outcomes, reveals, and proposed actions still do.
 */
export function effectiveDispositionDelta(proposed: number, trigger: DispositionTrigger): number {
  const delta = clampDispositionDelta(proposed)
  if (delta === 0) return 0
  if (!trigger.checkResolved && !trigger.revealed && !trigger.proposedAction) return 0
  return delta
}

/**
 * Caps how far one scene can push a PC's standing. `netDrift` is the signed movement already
 * spent this scene, so a correction back toward where it started is always allowed.
 */
export function cappedSceneDelta(delta: number, netDrift: number): number {
  if (delta === 0) return 0
  const room = delta > 0 ? SCENE_DISPOSITION_DRIFT_MAX - netDrift : SCENE_DISPOSITION_DRIFT_MAX + netDrift
  if (room <= 0) return 0
  return delta > 0 ? Math.min(delta, room) : Math.max(delta, -room)
}

export type DispositionBand = 'hostile' | 'unfriendly' | 'neutral' | 'friendly' | 'devoted'

/** Labeled bands (F10 SS5): hostile <= -6, devoted >= +6, neutral around zero. */
export function dispositionBand(value: number): DispositionBand {
  if (value <= -6) return 'hostile'
  if (value <= -2) return 'unfriendly'
  if (value >= 6) return 'devoted'
  if (value >= 2) return 'friendly'
  return 'neutral'
}

/** Opening size from the unlocking check's margin: -4 on success by 5+, else -2 (F10 SS3.7). */
export function openingDcMod(margin: number): -2 | -4 {
  return margin >= 5 ? -4 : -2
}

/**
 * A PC may consume an opening only if someone else unlocked it (self-consume blocked
 * server-side) and it targets the skill they are attempting against that NPC.
 */
export function canConsumeOpening(
  opening: OpeningView,
  consumer: { characterId: string; npcId: string; skill: string },
): boolean {
  return (
    opening.unlockedBy !== consumer.characterId &&
    opening.npcId === consumer.npcId &&
    opening.skill === consumer.skill
  )
}

export interface RevealContext {
  npcId: string
  actorCharacterId: string
  /** True when the triggering utterance carried a successful influence/insight check. */
  checkPassed: boolean
}

export type RevealVerdict = { allowed: true } | { allowed: false; reason: string }

/**
 * Server-side reveal gate (F10 SS3.4): an NPC cannot reveal an ingredient that is already
 * discovered, placed elsewhere, condition-locked without a passed check, or affinity-bound to
 * a different character - no matter what the model asked for.
 */
export function revealVerdict(candidate: RevealCandidate, ctx: RevealContext): RevealVerdict {
  if (candidate.discovered) return { allowed: false, reason: 'already discovered' }
  if (candidate.npcId !== null && candidate.npcId !== ctx.npcId) {
    return { allowed: false, reason: 'placed on a different NPC' }
  }
  if (candidate.npcId === null && candidate.locationId !== null) {
    return { allowed: false, reason: 'placed at a location, not on this NPC' }
  }
  if (candidate.condition && !ctx.checkPassed) {
    return { allowed: false, reason: `condition not met: ${candidate.condition}` }
  }
  if (!candidate.anyPc && candidate.boundCharacterId && candidate.boundCharacterId !== ctx.actorCharacterId) {
    return { allowed: false, reason: 'affinity-bound to another character' }
  }
  return { allowed: true }
}

export function filterReveals(
  requestedIds: string[],
  candidates: RevealCandidate[],
  ctx: RevealContext,
): { allowed: string[]; blocked: { id: string; reason: string }[] } {
  const byId = new Map(candidates.map((c) => [c.id, c]))
  const allowed: string[] = []
  const blocked: { id: string; reason: string }[] = []
  for (const id of new Set(requestedIds)) {
    const candidate = byId.get(id)
    if (!candidate) {
      blocked.push({ id, reason: 'unknown ingredient' })
      continue
    }
    const verdict = revealVerdict(candidate, ctx)
    if (verdict.allowed) allowed.push(id)
    else blocked.push({ id, reason: verdict.reason })
  }
  return { allowed, blocked }
}

export interface LocationRevealContext {
  /** The scene's current location; a null scene location can never match a placement. */
  locationId: string | null
  actorCharacterId: string
  /** True when the discovering attempt actually succeeded (search, challenge, adjudicated do). */
  checkPassed: boolean
}

/**
 * The location half of the reveal gate. NPC-placed evidence comes out of NPC mouths
 * (revealVerdict); location-placed evidence had no writer at all until this - a searched
 * murder scene surfaced nothing, ever. A successful attempt in the right room is what
 * entitles a PC to it.
 */
export function locationRevealVerdict(candidate: RevealCandidate, ctx: LocationRevealContext): RevealVerdict {
  if (candidate.discovered) return { allowed: false, reason: 'already discovered' }
  // A clue may be placed on an NPC AND at a location - stage 4 authors 15 of 35 that way, live
  // 2026-07-20. Refusing those left them extractable only from the NPC's mouth, which is the
  // very hole this gate exists to close. Either placement earns it; the NPC gate still owns
  // its own half.
  if (candidate.locationId === null) return { allowed: false, reason: 'not placed at a location' }
  if (ctx.locationId === null || candidate.locationId !== ctx.locationId) {
    return { allowed: false, reason: 'placed at a different location' }
  }
  if (!ctx.checkPassed) return { allowed: false, reason: 'the attempt did not succeed' }
  if (!candidate.anyPc && candidate.boundCharacterId && candidate.boundCharacterId !== ctx.actorCharacterId) {
    return { allowed: false, reason: 'affinity-bound to another character' }
  }
  return { allowed: true }
}

export function filterLocationReveals(
  candidates: RevealCandidate[],
  ctx: LocationRevealContext,
): { allowed: string[]; blocked: { id: string; reason: string }[] } {
  const allowed: string[] = []
  const blocked: { id: string; reason: string }[] = []
  for (const candidate of candidates) {
    const verdict = locationRevealVerdict(candidate, ctx)
    if (verdict.allowed) allowed.push(candidate.id)
    else blocked.push({ id: candidate.id, reason: verdict.reason })
  }
  return { allowed, blocked }
}

/**
 * Conservative full-AI policy for NPC proposed actions (F10 SS3.4): give_item/leave auto;
 * join_combat only from friendly disposition up; canonize routes to F8 (Phase 6) - never auto.
 */
export function actionAutoAllowed(action: NpcProposedAction, disposition: number): boolean {
  switch (action.type) {
    case 'give_item':
    case 'leave':
      return true
    case 'join_combat':
      return dispositionBand(disposition) === 'friendly' || dispositionBand(disposition) === 'devoted'
    case 'canonize_theory':
      return false
  }
}
