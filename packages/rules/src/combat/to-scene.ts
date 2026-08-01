// Engine state -> the app's scene-level CombatState (F09, 2026-07-31).
//
// The engine and the app describe the same fight in two different shapes, and nothing joined them:
// `resolveManifest` ran the whole battle inside one function and returned only a CombatResult, so
// the state holding tokens, positions and initiative was discarded when it returned. `state.combat`
// - and with it the play battle map - was written by the scripted demo and by nothing else.
//
// This is that join, kept pure so it can be tested without a session. Combat stays an isolated
// black box: this module reads engine types and emits state types, and imports nothing from the
// story spine.

import { formatDiceExpr } from './dice.ts'
import type { CombatEngineState } from './types.ts'
import type { CombatState, MapFit, MediaRef, TokenState, TurnOptions } from '../state/types.ts'

export interface ToSceneOptions {
  /** Where the fight happens, for the scene banner. */
  locationId: string | null
  /**
   * Where the battle map's artwork lives, or null to render the bare grid.
   *
   * The fight's map is authored: the location's own drawn map first, else the `battle_maps` row
   * stage 5 bound to the encounter by tag match - and the initiator already reads that map's grid,
   * obstacles and spawn cells. A REF, not a URL: the client signs it at render time, so it cannot
   * rot the way a signed link baked into durable state does (see MediaRef).
   *
   * Null stays a working state, not a broken one - grid and tokens render without artwork, which
   * is what an unassigned fight on the open field gets.
   */
  map: MediaRef | null
  /** How the artwork lays over the grid; 'cover' when the map row does not say. */
  mapFit?: MapFit
  /**
   * Portrait per combatant id, keyed like `controllers`. Absent is null - which is every token in
   * an engine-run fight today, because the manifest carries no artwork for its combatants.
   */
  tokenImages?: Record<string, MediaRef | null>
  /**
   * Who may drive each token, keyed by combatant id. Anything absent is 'ai'.
   *
   * READ-ONLY BY DEFAULT, deliberately. `battle-map.tsx` gates token drags on
   * `controller === 'player' && controllerUserId === <the actor>`, so handing a PC token to a
   * player is what makes the map interactive - and until a combat action route exists to receive
   * that input, an interactive map would let a player drag a token into a fight nothing is
   * listening to. Grant control in the same change that lands the route, not before.
   */
  controllers?: Record<string, { controller: TokenState['controller']; userId: string | null }>
}

const SIDE_TO_ALLEGIANCE: Record<string, TokenState['allegiance']> = {
  party: 'party',
  enemy: 'enemy',
}

/**
 * The active combatant's own action menu, or null when the turn belongs to the AI.
 *
 * Only ever ONE combatant's stats, and only ever the one whose turn it is - which is why this can
 * be published to players at all. The Lab's forecast card computes hit chances client-side from
 * every enemy's full block; doing that here would ship exactly the numbers the 2026-07-22 redaction
 * decision keeps hidden.
 */
export function turnOptions(engine: CombatEngineState): TurnOptions | null {
  if (engine.status !== 'active') return null
  const active = engine.combatants.find((c) => c.id === engine.initiative[engine.turnIndex]?.id)
  if (!active || active.auto) return null
  const standCost = Math.ceil(active.speed / 2)
  return {
    tokenId: active.id,
    attacks: active.attacks.map((a, index) => ({
      index,
      name: a.name,
      kind: a.kind,
      toHit: a.toHit,
      damage: formatDiceExpr(a.damage),
      range: a.range,
      longRange: a.longRange ?? null,
    })),
    canStandUp: active.conditions.includes('prone') && engine.economy.move >= standCost,
    standCost,
  }
}

export function combatStateFromEngine(engine: CombatEngineState, opts: ToSceneOptions): CombatState {
  const activeId = engine.initiative[engine.turnIndex]?.id ?? engine.combatants[0]?.id ?? ''
  return {
    locationId: opts.locationId,
    map: opts.map,
    obstacles: engine.obstacles,
    tokens: engine.combatants.map((c): TokenState => {
      const control = opts.controllers?.[c.id]
      return {
        id: c.id,
        kind: c.kind,
        // The engine allows a null refId for ad-hoc tokens; the scene shape does not, and an empty
        // string is the value the demo script already uses for a token with nothing behind it.
        refId: c.refId ?? '',
        name: c.name,
        image: opts.tokenImages?.[c.id] ?? null,
        x: c.x,
        y: c.y,
        hp: { current: c.hp.current, max: c.hp.max, temp: c.hp.temp },
        conditions: [...(c.conditions ?? [])],
        allegiance: SIDE_TO_ALLEGIANCE[c.side] ?? 'neutral',
        controller: control?.controller ?? 'ai',
        controllerUserId: control?.userId ?? null,
        speed: c.speed,
      }
    }),
    initiative: engine.initiative.map((i) => ({ tokenId: i.id, roll: i.total })),
    round: engine.round,
    activeTokenId: activeId,
    // The engine tracks no reaction, so it is reported unspent - the scene shape carries the field
    // for a rule the engine does not implement yet, and claiming it were used would be a lie.
    economy: { ...engine.economy, reaction: true },
    options: turnOptions(engine),
    // The board the ENGINE is playing on, not the renderer's default - these come from the
    // assigned map's authored grid and are what every bounds check upstream already honours.
    gridWidth: engine.gridWidth,
    gridHeight: engine.gridHeight,
    mapFit: opts.mapFit ?? 'cover',
  }
}
