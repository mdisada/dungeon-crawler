// One player decision in a live fight (F09, 2026-08-01).
//
// This is the write path the battle map was built for and never had. The client sends an INTENT -
// "attack combatant e2 with attack 0" - and never engine state; the server rehydrates the engine
// from dm.combat, resolves that one action, plays out the AI turns that answer it, and commits the
// result. Same shape as move_intent, which has proved the pattern since F06: validate here, apply
// here, broadcast the committed truth. The single writer never moves.
//
// It sits BETWEEN the two halves of combat on purpose. combat.ts stays spine-free (it may not
// import encounters.ts without a cycle), so the two re-entry seams a finished fight needs -
// applyNpcState(boss) and resolveOpenEncounter(tier) - are called from here instead, exactly as
// encounters.ts calls them for the headless path. Nothing imports this module but index.ts.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  awaitsPlayer, bossNpcStateForOutcome, combatStateFromEngine, deriveResult, fightIsOver,
  recapLines, resolveAction, runAiTurns, stepRng,
} from '../_shared/combat/index.ts'
import type {
  CombatAction, CombatEngineState, CombatEvent, ToSceneOptions,
} from '../_shared/combat/index.ts'
import type { GameState, Json, LiveCombatState } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { loadCombatControllers } from './combat.ts'
import { activeEncounter, resolveOpenEncounter } from './encounters.ts'
import { applyNpcState } from './npc-state.ts'
import { appendLinesDiff, newLine } from './orchestrate.ts'
import { commitDiffs, loadContext, loadState, logEvent } from './util.ts'

type Result = { status: number; body: Record<string, unknown> }

/** `dm.combat` is stored as Json; this is the one place it becomes an engine state again. */
function engineOf(live: LiveCombatState): CombatEngineState {
  return live.engine as unknown as CombatEngineState
}

export function liveCombat(state: GameState): LiveCombatState | null {
  return state.dm?.combat ?? null
}

/**
 * The client's action envelope -> a CombatAction, or null when it is not one.
 *
 * Deliberately narrow. `move` is here because a token drag has to go THROUGH the engine now: the
 * old move_intent path wrote state.combat directly, which was correct while nothing else knew
 * where the tokens were and is a desync the moment an engine holds the same positions.
 */
function parseCombatAction(body: Record<string, unknown>): CombatAction | null {
  const raw = body.combat_action
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const action = raw as Record<string, unknown>
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  switch (action.type) {
    case 'move': {
      const to = Array.isArray(action.to) ? action.to : null
      const x = num(to?.[0])
      const y = num(to?.[1])
      return x === null || y === null ? null : { type: 'move', to: [Math.round(x), Math.round(y)] }
    }
    case 'attack': {
      const index = num(action.attackIndex)
      return typeof action.targetId === 'string' && index !== null
        ? { type: 'attack', targetId: action.targetId, attackIndex: Math.round(index) }
        : null
    }
    case 'dodge':
    case 'dash':
    case 'disengage':
    case 'stand_up':
    case 'end_turn':
      return { type: action.type }
    default:
      return null
  }
}

/**
 * The combat state patch is a whole-object REPLACE in effect (every field is written), but where
 * the fight is and what it looks like are not the engine's to know - they were settled when it
 * started. Carried forward from what is already on the wire so a turn cannot blank the map.
 *
 * The signed URL rides along unchanged for the length of the fight. It is good for an hour, the
 * same TTL every background and portrait in this app carries; a fight that outlasts one loses its
 * artwork and keeps its grid, which is the same way a long scene loses its backdrop today.
 */
function sceneCarryOver(state: GameState): Pick<ToSceneOptions, 'locationId' | 'mapUrl' | 'mapFit'> {
  return {
    locationId: state.combat?.locationId ?? null,
    mapUrl: state.combat?.mapUrl ?? null,
    mapFit: state.combat?.mapFit ?? 'cover',
  }
}

export async function combatAction(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  body: Record<string, unknown>,
): Promise<Result> {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { status: 404, body: { error: 'Adventure not found' } }
  if (ctx.member?.spectator) return { status: 403, body: { error: 'Spectators cannot act in combat' } }

  const action = parseCombatAction(body)
  if (!action) return { status: 400, body: { error: 'combat_action required' } }

  const row = await loadState(service, adventureId)
  const live = liveCombat(row.state)
  if (!live) return { status: 409, body: { error: 'No fight is being played' } }

  const engine = engineOf(live)
  if (fightIsOver(engine, live.bossRef)) return { status: 409, body: { error: 'The fight is already over' } }

  const active = engine.combatants.find((c) => c.id === engine.initiative[engine.turnIndex]?.id)
  if (!active) return { status: 409, body: { error: 'No active combatant' } }
  // A drag names the token it grabbed, and resolveAction only ever acts on the ACTIVE combatant -
  // so a drag of anyone else would silently move the wrong token. The DM can drag any token off
  // the initiative order in a scripted scene; inside an engine fight nobody can.
  if (typeof body.token_id === 'string' && body.token_id !== active.id) {
    return { status: 200, body: { ok: false, reason: 'Not that token\'s turn' } }
  }
  // Control is checked against the CONTROLLER table, not against the token the client sent - the
  // client does not choose whose turn it acts on. The DM drives any turn, the same latitude the
  // move validator already grants them.
  const controllers = await loadCombatControllers(service, adventureId, engine)
  if (!ctx.isDm && controllers[active.id]?.userId !== userId) {
    return { status: 200, body: { ok: false, reason: "It is not your token's turn" } }
  }

  let next: CombatEngineState
  let events: CombatEvent[]
  try {
    const resolved = resolveAction(engine, action, stepRng(live.seed, live.step))
    next = resolved.state
    events = resolved.events
  } catch (err) {
    // CombatError is the engine refusing an illegal action ("No action left", "Out of range"). It
    // is a verdict for the player, not a server fault - same 200-with-a-reason shape as a rejected
    // move, so the map can snap back and say why.
    return { status: 200, body: { ok: false, reason: err instanceof Error ? err.message : 'Illegal action' } }
  }

  const ai = runAiTurns(next, live.seed, live.step + 1, live.bossRef)
  const allEvents = [...events, ...ai.events]
  const scene = sceneCarryOver(row.state)
  const names = new Map(ai.state.combatants.map((c) => [c.id, c.name]))
  const sides = new Map(ai.state.combatants.map((c) => [c.id, c.side]))
  const lines = recapLines(allEvents, {
    name: (id) => names.get(id) ?? 'someone',
    isParty: (id) => sides.get(id) === 'party',
  })

  await commitDiffs(service, adventureId, (s) => [
    {
      domain: 'combat',
      patch: combatStateFromEngine(ai.state, { ...scene, controllers }) as unknown as Json,
    },
    {
      domain: 'dm',
      patch: { combat: { ...live, engine: ai.state as unknown as Json, step: ai.step } as unknown as Json },
    },
    ...(lines.length > 0 ? [appendLinesDiff(s, lines.map((text) => newLine(null, null, text)))] : []),
  ])
  await logEvent(service, adventureId, row.state.session.id, 'combat_action', {
    action_type: action.type, combatant_id: active.id, by: userId, round: ai.state.round,
    events: allEvents.length,
  })

  if (fightIsOver(ai.state, live.bossRef)) {
    await finishLiveCombat(service, ctx, adventureId, row.state, live, ai.state)
    return { status: 200, body: { ok: true, resolved: 'combat_over' } }
  }
  // The fight is live but the turn came back to the AI: runAiTurns hit its cap, which is a
  // heuristic that will not yield. Resolve on the state we have rather than persist a board no one
  // can act on - a missing gate is recoverable, a dead table is not.
  if (!awaitsPlayer(ai.state, live.bossRef)) {
    await logEvent(service, adventureId, row.state.session.id, 'incident', {
      kind: 'combat_ai_turn_cap', round: ai.state.round, actions: ai.step,
    }).catch(() => {})
    await finishLiveCombat(service, ctx, adventureId, row.state, live, ai.state)
    return { status: 200, body: { ok: true, resolved: 'combat_over' } }
  }
  return { status: 200, body: { ok: true, resolved: 'combat_action' } }
}

/**
 * The fight has ended: clear the map, then re-enter the story spine through the same two seams the
 * headless resolver uses - applyNpcState for the boss's fate, then resolveOpenEncounter for the
 * tier. Order matters: the boss's state has to land BEFORE the aftermath narrates, or the prose
 * describes a world where the antagonist is still standing.
 *
 * The engine's `partial` tier (a win that cost the party someone) maps onto a PASS, because
 * ResolutionTier has been pass/fail since 2026-07-27 - an imperfect win is a win whose price the
 * narration carries.
 */
async function finishLiveCombat(
  service: SupabaseClient,
  ctx: NonNullable<Awaited<ReturnType<typeof loadContext>>>,
  adventureId: string,
  before: GameState,
  live: LiveCombatState,
  final: CombatEngineState,
): Promise<void> {
  const sessionId = before.session.id ?? ''
  const encounter = activeEncounter(before)
  const result = deriveResult(final, { bossRef: live.bossRef })
  const env: AgentEnv = {
    service, adventureId, creatorId: ctx.adventure.creator_id, demo: ctx.adventure.demo,
    mode: ctx.adventure.mode,
  }

  // The map comes down first. Everything after this narrates, and the aftermath belongs on the
  // scene stage, not over a board of corpses.
  await commitDiffs(service, adventureId, () => [
    { domain: 'combat', patch: null },
    { domain: 'dm', patch: { combat: null } },
  ])

  await logEvent(service, adventureId, sessionId, 'combat_resolved', {
    label: encounter?.label ?? null, outcome: result.outcome, tier: result.tier,
    boss_outcome: result.bossOutcome, casualties: result.casualties as unknown as Json,
    encounter_id: live.encounterId, seed: live.seed, actions: live.step, rounds: final.round,
    warnings: live.warnings, resolver: 'engine_interactive',
  })

  if (live.boss) {
    const npcState = bossNpcStateForOutcome(result.bossOutcome)
    if (npcState) {
      await applyNpcState(
        service, env, sessionId, live.boss, npcState, 'combat',
        `boss ${result.bossOutcome} in "${encounter?.label ?? 'the fight'}"`,
      )
    }
  }

  const label = encounter?.label ?? 'the fight'
  const pcDown = result.casualties.pcIds.length
  const context = result.tier === 'failed'
    ? `The fight ("${label}") turned against the party - they were overwhelmed and went down. ` +
      'Narrate the fail-forward AFTERMATH: the party is beaten (unconscious, not dead) and the story ' +
      'moves on, worse for it. The table watched the fight happen - do not re-narrate the blow-by-blow.'
    : `The fight ("${label}") is over and the party won.` +
      (live.boss && result.bossOutcome === 'killed' ? ` ${live.boss.name} lies dead among them.` : '') +
      (pcDown > 0 ? ` The win came at a cost - ${pcDown} of the party fell before the end.` : '') +
      ' Narrate the AFTERMATH as the scene settles - what the victory cost and what it opens. The ' +
      'table watched the fight happen - do not re-narrate the blow-by-blow.'
  await resolveOpenEncounter(service, env, sessionId, result.tier === 'failed' ? 'failed' : 'full', context)
}
