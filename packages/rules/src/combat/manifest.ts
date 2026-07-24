// The combat integration boundary (F09 SS3, F09.0a). Combat is an isolated black box: a
// CombatManifest goes IN and a CombatResult comes OUT. This module is pure data + pure functions
// - no I/O, no session/story imports - so the SAME initiator runs in the Deno edge runtime (live
// play) and the browser (Combat Lab), and the import graph itself guarantees combat never reaches
// into the story consistency/pacing spine. The engine has no boss concept; "boss down ends the
// fight", the outcome->tier mapping, and boss fate all live HERE, layered on the engine via the
// manifest's bossRef.

import { characterToSetup, npcStatBlockToSetup } from './convert.ts'
import type { PartyMemberInput } from './convert.ts'
import { DIFFICULTY_PRESETS, STANDARD_DIFFICULTY } from './difficulty.ts'
import type { CombatSetup } from './engine.ts'
import { monsterSetup, MONSTER_FIXTURES } from './fixtures.ts'
import { inBounds } from './grid.ts'
import type { Cell, GridBounds } from './grid.ts'
import type { CombatantSetup, CombatEngineState, DifficultySetting } from './types.ts'
import { deriveNpcStatBlock } from '../guide/npc-stats.ts'
import type { NpcStatBlock } from '../guide/npc-stats.ts'

// --- Contracts ------------------------------------------------------------------------------

/** How the fight resolved for the boss; set by the post-victory spare/capture beat (F09 SS3.6). */
export type BossOutcome = 'killed' | 'escaped' | 'captured' | 'spared' | 'none'

/** One authored enemy line from `encounters.spec.enemies` (shape-compatible with guide EnemySpec). */
export interface ManifestEnemyGroup {
  name: string
  cr: string
  count: number
}

/** An adventure `npcs` row the initiator may join by name (enemies) or role (the boss). */
export interface ManifestNpcRow {
  id: string
  name: string
  role: 'npc' | 'boss'
  statBlock: NpcStatBlock
  imageUrl?: string | null
}

/** The resolved battle map: obstacles, per-side spawn cells, and grid size (F09 SS3.4/SS3.7). */
export interface ManifestMapInput {
  mapId: string | null
  obstacles: Cell[]
  spawns: { party: Cell[]; enemy: Cell[] }
  gridWidth: number
  gridHeight: number
}

/** The live beat's outcome atoms the CombatResult tier maps to (F09 SS3.2); no session types. */
export interface ManifestBeatSpec {
  label: string
  stakes: string
  onSuccess: string[]
  onPartial: string[]
  onFailure: string[]
}

/** Everything the code-first initiator joins - already-fetched rows, never fetched here. */
export interface BuildManifestInput {
  encounterId: string | null
  enemies: ManifestEnemyGroup[]
  npcs: ManifestNpcRow[]
  party: PartyMemberInput[]
  map: ManifestMapInput
  /**
   * Explicit boss selection: this npc id is the fight's boss (added as a combatant if it is not
   * already among the built enemies). Omit it and a boss is marked ONLY when a role='boss' npc is
   * named in spec.enemies - so passing the whole adventure's npcs to a routine patrol never injects
   * the campaign boss.
   */
  bossNpcId?: string | null
  /** adventures.difficulty_setting.preset; defaults to 'standard'. */
  baselinePreset?: string
  /** Per-encounter intensity shift in ladder steps (the guide's escalation curve, F09 SS7.1). */
  intensity?: number
  /** Lab override: a hand-picked preset wins over baseline x intensity. */
  difficultyOverride?: DifficultySetting
  beatSpec?: ManifestBeatSpec
}

/** The INPUT artifact that crosses the isolation boundary (F09 SS3.2). */
export interface CombatManifest {
  encounterId: string | null
  mapId: string | null
  party: CombatantSetup[]
  enemies: CombatantSetup[]
  /** The enemy id the engine must treat as the boss; null when the fight has none. */
  bossRef: string | null
  difficulty: DifficultySetting
  obstacles: Cell[]
  gridWidth: number
  gridHeight: number
  beatSpec: ManifestBeatSpec | null
  /** Diagnostic gap-fills the initiator made (a CR-derived enemy, no free spawn, ...) - F09 SS12. */
  warnings: string[]
}

/** The OUTPUT artifact that crosses back (F09 SS3.3). */
export interface CombatResult {
  outcome: 'victory' | 'defeat'
  tier: 'full' | 'partial' | 'failed'
  bossOutcome: BossOutcome
  casualties: { pcIds: string[]; npcIds: string[] }
}

// --- Difficulty ------------------------------------------------------------------------------

const PRESET_BY_NAME = new Map(DIFFICULTY_PRESETS.map((p) => [p.name.toLowerCase(), p]))

/**
 * The per-adventure baseline preset shifted by the per-encounter intensity (F09 SS7.1): the player
 * owns the baseline dial, the guide owns the escalation curve. Intensity is a signed ladder shift
 * (Story..Deadly), clamped to the preset range. Unknown presets fall back to Standard.
 */
export function resolveDifficulty(preset: string | undefined, intensity = 0): DifficultySetting {
  const base = PRESET_BY_NAME.get((preset ?? 'standard').toLowerCase()) ?? STANDARD_DIFFICULTY
  if (!intensity) return base
  const idx = DIFFICULTY_PRESETS.indexOf(base)
  const shifted = Math.max(0, Math.min(DIFFICULTY_PRESETS.length - 1, idx + Math.round(intensity)))
  return DIFFICULTY_PRESETS[shifted]
}

// --- Initiator (code-first join) -------------------------------------------------------------

function fixtureKeyByName(name: string): string | null {
  const n = name.trim().toLowerCase()
  const f = MONSTER_FIXTURES.find((x) => x.name.toLowerCase() === n || x.key === n)
  return f ? f.key : null
}

/** One enemy combatant: authored stat block (name match) -> SRD fixture (name match) -> CR-derived. */
function buildEnemy(
  name: string,
  cr: string,
  id: string,
  npcByName: Map<string, ManifestNpcRow>,
  warnings: string[],
): CombatantSetup {
  const npc = npcByName.get(name.trim().toLowerCase())
  if (npc) {
    return npcStatBlockToSetup(npc.statBlock, {
      id, name: npc.name, side: 'enemy', refId: npc.id, imageUrl: npc.imageUrl ?? null, auto: true,
    })
  }
  const key = fixtureKeyByName(name)
  if (key) {
    // Keep the authored name (a "Brine Raider" reskin of a bandit reads as authored, not generic).
    return { ...monsterSetup(key, { id, side: 'enemy', auto: true }), name }
  }
  warnings.push(`No stat block or SRD fixture for "${name}" (CR ${cr}); derived a generic block.`)
  return npcStatBlockToSetup(deriveNpcStatBlock({ cr }, 'npc'), { id, name, side: 'enemy', refId: null, auto: true })
}

/**
 * The combat initiator (F09 SS3.1): deterministically JOIN authored rows into a manifest. Reused
 * verbatim by live play and the Combat Lab - the manifest is the single artifact that crosses the
 * boundary in both directions. Enemy ids are deterministic (`e0`, `e1`, ...) so a seed replays
 * byte-identically. Never invents stat blocks: fixtures fill named gaps, a CR-derived block is the
 * last resort (and is logged to `warnings`).
 */
export function buildManifest(input: BuildManifestInput): CombatManifest {
  const warnings: string[] = []
  const npcByName = new Map(input.npcs.map((n) => [n.name.trim().toLowerCase(), n]))
  const bossNpc = input.npcs.find((n) => n.role === 'boss') ?? null

  const enemies: CombatantSetup[] = []
  let ei = 0
  for (const group of input.enemies) {
    const count = Math.max(1, Math.min(30, Math.round(group.count || 1)))
    for (let k = 0; k < count; k++) {
      enemies.push(buildEnemy(group.name, group.cr, `e${ei++}`, npcByName, warnings))
    }
  }

  // The manifest MUST mark the boss because the engine has none (F09 SS3.6/SS12). Two paths: an
  // explicit bossNpcId (a climax boss authored only as an npcs row is added as a combatant), or a
  // role='boss' npc that was named in spec.enemies (already built above).
  let bossRef: string | null = null
  const explicitBoss = input.bossNpcId ? input.npcs.find((n) => n.id === input.bossNpcId) ?? null : null
  if (explicitBoss) {
    let bossSetup = enemies.find((e) => e.refId === explicitBoss.id) ?? null
    if (!bossSetup) {
      bossSetup = npcStatBlockToSetup(explicitBoss.statBlock, {
        id: `e${ei++}`, name: explicitBoss.name, side: 'enemy', refId: explicitBoss.id, imageUrl: explicitBoss.imageUrl ?? null, auto: true,
      })
      enemies.push(bossSetup)
    }
    bossRef = bossSetup.id
  } else if (bossNpc) {
    bossRef = enemies.find((e) => e.refId === bossNpc.id)?.id ?? null
  }

  const party = input.party.map((m) => characterToSetup(m))
  const difficulty = input.difficultyOverride ?? resolveDifficulty(input.baselinePreset, input.intensity)

  const bounds: GridBounds = { width: input.map.gridWidth, height: input.map.gridHeight }
  const obstacleSet = new Set(input.map.obstacles.map(([x, y]) => `${x},${y}`))
  const occupied = new Set<string>()
  placeSide(party, input.map.spawns.party, 'party', bounds, obstacleSet, occupied, warnings)
  placeSide(enemies, input.map.spawns.enemy, 'enemy', bounds, obstacleSet, occupied, warnings)

  return {
    encounterId: input.encounterId,
    mapId: input.map.mapId,
    party,
    enemies,
    bossRef,
    difficulty,
    obstacles: input.map.obstacles,
    gridWidth: input.map.gridWidth,
    gridHeight: input.map.gridHeight,
    beatSpec: input.beatSpec ?? null,
    warnings,
  }
}

/** Deploy a side onto its spawn cells in order (F09 SS3.7), falling back to a free-column scan. */
function placeSide(
  setups: CombatantSetup[],
  spawnCells: Cell[],
  side: 'party' | 'enemy',
  bounds: GridBounds,
  obstacleSet: Set<string>,
  occupied: Set<string>,
  warnings: string[],
): void {
  const isFree = (x: number, y: number) =>
    inBounds(x, y, bounds) && !obstacleSet.has(`${x},${y}`) && !occupied.has(`${x},${y}`)
  const preferredCol = side === 'party'
    ? Math.min(bounds.width - 1, 2)
    : Math.max(0, bounds.width - 3)
  let spawnIdx = 0
  for (const setup of setups) {
    let cell: Cell | null = null
    while (spawnIdx < spawnCells.length) {
      const [x, y] = spawnCells[spawnIdx++]
      if (isFree(x, y)) {
        cell = [x, y]
        break
      }
    }
    if (!cell) cell = firstFreeCell(preferredCol, bounds, isFree)
    if (!cell) {
      warnings.push(`No free square to deploy ${setup.name}.`)
      continue
    }
    setup.x = cell[0]
    setup.y = cell[1]
    occupied.add(`${cell[0]},${cell[1]}`)
  }
}

/** First free cell scanning the preferred column, then columns fanning outward. Deterministic. */
function firstFreeCell(
  preferredCol: number,
  bounds: GridBounds,
  isFree: (x: number, y: number) => boolean,
): Cell | null {
  const cols = [preferredCol]
  for (let d = 1; d < bounds.width; d++) {
    if (preferredCol - d >= 0) cols.push(preferredCol - d)
    if (preferredCol + d < bounds.width) cols.push(preferredCol + d)
  }
  for (const cx of cols) {
    for (let y = 0; y < bounds.height; y++) {
      if (isFree(cx, y)) return [cx, y]
    }
  }
  return null
}

/** The manifest as a `createCombat` input - the shared start-of-fight assembly (Lab + live play). */
export function manifestToSetup(manifest: CombatManifest): CombatSetup {
  return {
    combatants: [...manifest.party, ...manifest.enemies],
    obstacles: manifest.obstacles,
    difficulty: manifest.difficulty,
    gridWidth: manifest.gridWidth,
    gridHeight: manifest.gridHeight,
  }
}

// --- Result derivation -----------------------------------------------------------------------

/**
 * Whether the fight is over from the DRIVER's view: the engine ended (side elimination) OR the
 * manifest's boss is down. "Boss down ends the fight" (surviving minions rout, F09 SS3.6) is a
 * driver layer because the engine has no boss concept - so a driver checks this after each turn.
 */
export function fightIsOver(state: CombatEngineState, bossRef: string | null): boolean {
  if (state.status !== 'active') return true
  if (bossRef) {
    const boss = state.combatants.find((c) => c.id === bossRef)
    if (boss?.dead) return true
  }
  return false
}

/**
 * Final engine state -> the story-facing CombatResult (F09 SS3.3). `outcome`/`casualties` come from
 * the engine; `tier` is the outcome->story map (victory clean = full, victory with a downed PC =
 * partial, defeat = failed, fail-forward). `bossOutcome` is set by the spare/capture beat when
 * provided; otherwise a mechanical default (boss dead = killed, otherwise routed = escaped).
 */
export function deriveResult(
  state: CombatEngineState,
  manifest: Pick<CombatManifest, 'bossRef'>,
  opts?: { bossOutcome?: BossOutcome },
): CombatResult {
  const boss = manifest.bossRef ? state.combatants.find((c) => c.id === manifest.bossRef) : null
  const bossDown = !!boss?.dead
  // Boss down => the party wins even with minions still standing (they rout). If the party was also
  // wiped (winner 'enemy') that still counts as a loss.
  const partyWins = state.winner === 'party' || (bossDown && state.winner !== 'enemy')
  const pcIds = state.combatants
    .filter((c) => c.side === 'party' && (c.dead || c.conditions.includes('unconscious')))
    .map((c) => c.id)
  const npcIds = state.combatants.filter((c) => c.side === 'enemy' && c.dead).map((c) => c.id)
  const tier: CombatResult['tier'] = !partyWins ? 'failed' : pcIds.length > 0 ? 'partial' : 'full'

  let bossOutcome: BossOutcome = opts?.bossOutcome ?? 'none'
  if (!opts?.bossOutcome && manifest.bossRef) {
    bossOutcome = bossDown ? 'killed' : partyWins ? 'escaped' : 'none'
  }
  return { outcome: partyWins ? 'victory' : 'defeat', tier, bossOutcome, casualties: { pcIds, npcIds } }
}

/**
 * Boss fate -> the `npcStates` transition the live handler writes via applyNpcState (F09 SS3.3).
 * The single mapping so a spared/captured boss NEVER mis-scores as a defeat ending (the 2026-07-24
 * alive/absent regression: `alive` in endings.ts means present-and-not-dead, so a spared boss must
 * stay `alive`, never `dead`/`absent`). `none` = no state write. Revisit `captured` at live-wiring.
 */
export function bossNpcStateForOutcome(outcome: BossOutcome): 'dead' | 'absent' | 'alive' | null {
  switch (outcome) {
    case 'killed':
      return 'dead'
    case 'escaped':
      return 'absent'
    case 'spared':
      return 'alive'
    case 'captured':
      return 'alive'
    case 'none':
      return null
  }
}
