// Check Engine (F07 SS3.3-3.4, F10 SS3.2): d20 resolution with advantage, server-side DC
// bounds, the social DC table, SRD group checks, and assist effects. No LLM anywhere in here -
// specs come in already validated, dice come from the injected RNG.

import { rollDie } from './rng.ts'
import type { Rng } from './rng.ts'
import type { AdvDis, CheckResult, SocialMagnitude } from './types.ts'

export const DC_MIN = 5
export const DC_MAX = 25

/** Adjudicator DCs are clamped server-side regardless of model output (F07 SS3.3). */
export function clampDc(dc: number): number {
  if (Number.isNaN(dc)) return DC_MIN
  return Math.min(DC_MAX, Math.max(DC_MIN, Math.round(dc)))
}

/** Bounded social DC table (F10 SS3.2) - never a free LLM choice. */
export const SOCIAL_DC: Record<SocialMagnitude, number> = {
  trivial: 8,
  reasonable: 12,
  costly: 16,
  against_nature: 20,
}

/** +-2 disposition adjust: friendly bands ease the ask, hostile bands harden it. */
export function socialDc(magnitude: SocialMagnitude, disposition: number): number {
  const adjust = disposition >= 2 ? -2 : disposition <= -2 ? 2 : 0
  return clampDc(SOCIAL_DC[magnitude] + adjust)
}

export function rollCheck(rng: Rng, modifier: number, dc: number, advDis: AdvDis): CheckResult {
  const first = rollDie(rng, 20)
  const rolls = advDis === 'none' ? [first] : [first, rollDie(rng, 20)]
  const d20 = advDis === 'advantage' ? Math.max(...rolls) : advDis === 'disadvantage' ? Math.min(...rolls) : first
  const total = d20 + modifier
  return { rolls, d20, modifier, total, dc, success: total >= dc, margin: total - dc }
}

/** SRD group-check rule: the group succeeds when at least half the rollers pass (F07 SS3.4). */
export function groupOutcome(results: { success: boolean }[]): { passes: number; needed: number; success: boolean } {
  const passes = results.filter((r) => r.success).length
  const needed = Math.ceil(results.length / 2)
  return { passes, needed, success: results.length > 0 && passes >= needed }
}

/**
 * Assist effects (F07 SS3.4). `enable` gates the primary attempt on the assist succeeding;
 * `bonus` grants the primary advantage. An unclaimed slot leaves the primary unassisted
 * (enable-gated attempts fail forward - the caller narrates the off-ramp).
 */
export function applyAssist(
  effect: 'enable' | 'bonus',
  assist: CheckResult | null,
): { mayAttempt: boolean; primaryAdvDis: AdvDis } {
  if (effect === 'enable') {
    return { mayAttempt: assist?.success === true, primaryAdvDis: 'none' }
  }
  return { mayAttempt: true, primaryAdvDis: assist?.success ? 'advantage' : 'none' }
}

/** Prompt windows (seconds). Deadlines are enforced on the next server call, not by a timer. */
export const GROUP_PROMPT_WINDOW_S = 20
export const ASSIST_PROMPT_WINDOW_S = 15
export const SOLO_PROMPT_WINDOW_S = 20

export function promptDeadline(now: Date, windowSeconds: number): string {
  return new Date(now.getTime() + windowSeconds * 1000).toISOString()
}

export function promptExpired(deadline: string, now: Date): boolean {
  return now.getTime() >= Date.parse(deadline)
}
