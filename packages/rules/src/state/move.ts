// Token move validation (F06 SS3.1): drags emit a move_intent; the server validates with this
// exact function and broadcasts the committed position, so the client's optimistic move and
// the server verdict can never disagree on the rules. Full pathing/AoO arrive with F09's
// Grid Engine; Phase 4 checks bounds, obstacles, occupancy, control, and movement budget.

import { GRID_SIZE } from './types.ts'
import type { ActionEconomy, CombatState, GameState, Json, StateDiff, TokenState } from './types.ts'

export interface MoveActor {
  userId: string
  isDm: boolean
}

export type MoveVerdict =
  | { ok: true; cost: number; token: TokenState }
  | { ok: false; reason: string }

/** Chebyshev distance - diagonal moves cost 1 square, SRD-style simplified. */
export function moveCost(from: { x: number; y: number }, to: { x: number; y: number }): number {
  return Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y))
}

export function validateMove(
  state: GameState,
  tokenId: string,
  to: { x: number; y: number },
  actor: MoveActor,
): MoveVerdict {
  const combat = state.combat
  if (!combat) return { ok: false, reason: 'No active battle' }

  const token = combat.tokens.find((t) => t.id === tokenId)
  if (!token) return { ok: false, reason: 'Unknown token' }

  if (!Number.isInteger(to.x) || !Number.isInteger(to.y)) return { ok: false, reason: 'Off-grid position' }
  if (to.x < 0 || to.y < 0 || to.x >= GRID_SIZE || to.y >= GRID_SIZE) {
    return { ok: false, reason: 'Outside the map' }
  }
  if (combat.obstacles.some(([x, y]) => x === to.x && y === to.y)) {
    return { ok: false, reason: 'Blocked square' }
  }
  if (combat.tokens.some((t) => t.id !== tokenId && t.x === to.x && t.y === to.y)) {
    return { ok: false, reason: 'Square occupied' }
  }

  const cost = moveCost(token, to)
  if (cost === 0) return { ok: false, reason: 'Already there' }

  // DM moves any token at any time with no budget (F06 SS3.1).
  if (actor.isDm) return { ok: true, cost: 0, token }

  if (token.controller !== 'player' || token.controllerUserId !== actor.userId) {
    return { ok: false, reason: 'Not your token' }
  }
  if (combat.activeTokenId !== tokenId) return { ok: false, reason: 'Not your turn' }
  if (cost > combat.economy.move) return { ok: false, reason: 'Not enough movement' }

  return { ok: true, cost, token }
}

/** Builds the committed-position diff for a validated move (server-side, after validateMove). */
export function moveDiff(combat: CombatState, tokenId: string, to: { x: number; y: number }, cost: number): StateDiff {
  const tokens = combat.tokens.map((t) => (t.id === tokenId ? { ...t, x: to.x, y: to.y } : t))
  const economy: ActionEconomy =
    cost > 0 ? { ...combat.economy, move: combat.economy.move - cost } : combat.economy
  // Arrays replace wholesale under merge-patch, so tokens is emitted as a full list.
  return { domain: 'combat', patch: { tokens, economy } as unknown as Json }
}
