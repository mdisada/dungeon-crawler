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
