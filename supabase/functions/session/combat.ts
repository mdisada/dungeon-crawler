// F09.0a live combat resolve. Joins the current combat beat to its authored encounter, builds a
// CombatManifest via the SHARED initiator (@rules/combat, synced to _shared/combat), and runs the
// pure engine to completion single-writer, returning a CombatResult.
//
// Combat is an isolated black box: this module imports NOTHING from the story consistency/pacing
// spine (director / progress / agents / narration / canon / ledger / intent). It only reads
// authored rows and runs the deterministic engine. The caller (encounters.ts) performs the two
// spine calls - applyNpcState(boss) + resolveOpenEncounter(tier) - the same seams the placeholder
// already used. Keeping this module spine-free is both the isolation guarantee and what avoids an
// import cycle with encounters.ts.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  buildManifest, createCombat, deriveResult, fightIsOver, manifestToSetup, runAutoTurn,
} from '../_shared/combat/index.ts'
import type {
  Cell, CombatManifest, CombatResult, ManifestEnemyGroup, ManifestMapInput, ManifestNpcRow,
  PartyMemberInput,
} from '../_shared/combat/index.ts'
import { deriveNpcStatBlock } from '../_shared/guide/npc-stats.ts'
import type { NpcStatBlock } from '../_shared/guide/npc-stats.ts'
import { seededRng } from '../_shared/play/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'
import { activePcIds } from './orchestrate.ts'

const RESOLVE_TURN_CAP = 1000

/** The atoms a won/lost tier credits - taken from the LIVE beat, not the authored encounter. */
export interface BeatSpecInput {
  label: string
  stakes: string
  onSuccess: string[]
  onPartial: string[]
  onFailure: string[]
}

export interface LiveCombatResult {
  result: CombatResult
  /** The boss's npc id + name when the fight had a marked boss (for applyNpcState). */
  boss: { id: string; name: string } | null
  encounterId: string | null
  seed: number
  rounds: number
  warnings: string[]
}

function isCell(v: unknown): v is Cell {
  return Array.isArray(v) && v.length === 2 && typeof v[0] === 'number' && typeof v[1] === 'number'
}

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function parseEnemies(spec: unknown): ManifestEnemyGroup[] {
  const raw = asRecord(spec).enemies
  if (!Array.isArray(raw)) return []
  return raw.flatMap((e) => {
    const row = asRecord(e)
    const name = typeof row.name === 'string' ? row.name.trim() : ''
    if (!name) return []
    return [{
      name,
      cr: typeof row.cr === 'string' ? row.cr : '1/4',
      count: typeof row.count === 'number' && row.count > 0 ? Math.round(row.count) : 1,
    }]
  })
}

/** The mapless floor: an empty 32x32 field. The initiator's free-column scan deploys both sides. */
const OPEN_FIELD: ManifestMapInput = {
  mapId: null, obstacles: [], spawns: { party: [], enemy: [] }, gridWidth: 32, gridHeight: 32,
}

/**
 * The encounter's assigned `battle_maps` row -> ManifestMapInput (F09 SS3.4).
 *
 * Before this, the map came from `locations.map` jsonb - a column NOTHING has ever written, so
 * every engine-resolved fight ran on OPEN_FIELD with both sides on the fallback columns. The
 * assignment now lives on the encounter (stage 5, tag match) and the painted obstacles/spawns and
 * authored grid come from the map itself.
 */
function toMapInput(row: BattleMapRow | null): ManifestMapInput {
  if (!row) return OPEN_FIELD
  const cells = (v: unknown): Cell[] => (Array.isArray(v) ? v.filter(isCell) : [])
  const rawSpawns = row.spawns
  const spawns = Array.isArray(rawSpawns)
    ? { party: cells(rawSpawns), enemy: [] } // legacy flat spawns -> party side
    : { party: cells(asRecord(rawSpawns).party), enemy: cells(asRecord(rawSpawns).enemy) }
  return {
    mapId: row.id,
    obstacles: cells(row.obstacles),
    spawns,
    gridWidth: typeof row.grid_cols === 'number' ? row.grid_cols : OPEN_FIELD.gridWidth,
    gridHeight: typeof row.grid_rows === 'number' ? row.grid_rows : OPEN_FIELD.gridHeight,
  }
}

interface ObjectiveJoinRow {
  id: string
  chapter_id: string | null
  encounter_ids: string[] | null
}

interface BattleRow {
  id: string
  type: string
  spec: Json
  location_id: string | null
  battle_map_id: string | null
}

interface BattleMapRow {
  id: string
  grid_cols: number
  grid_rows: number
  obstacles: Json
  spawns: Json
}

interface NpcJoinRow {
  id: string
  name: string
  role: string
  stat_block: NpcStatBlock | null
}

interface PartyRow {
  id: string
  name: string
  level: number
  class_key: string | null
  abilities: PartyMemberInput['abilities']
  ability_bonuses: PartyMemberInput['abilityBonuses']
  hp_max: number | null
  hp_current: number | null
}

/**
 * Build the fight's CombatManifest from the current combat beat (objective -> authored encounter).
 * Returns null when there is no authored fight to run (ad-hoc beat, no enemies, no party, or a load
 * error) - the caller then falls back to the placeholder auto-win, so a session never breaks.
 */
async function buildLiveManifest(
  service: SupabaseClient,
  adventureId: string,
  state: GameState,
  beatSpec: BeatSpecInput,
  bossNpcId: string | null,
): Promise<{ manifest: CombatManifest; boss: { id: string; name: string } | null } | null> {
  const objectiveId = state.objectives?.currentId ?? null
  if (!objectiveId) return null

  const { data: objective } = await service
    .from('objectives')
    .select('id, chapter_id, encounter_ids')
    .eq('id', objectiveId)
    .maybeSingle()
  const encounterIds = (objective as ObjectiveJoinRow | null)?.encounter_ids ?? []
  if (encounterIds.length === 0) return null

  const { data: battleRows } = await service
    .from('encounters')
    .select('id, type, spec, location_id, battle_map_id')
    .in('id', encounterIds)
    .eq('type', 'battle')
  // Sorted by id so a multi-battle objective picks the SAME fight on every run - PostgREST makes
  // no ordering promise for `.in()`, so "the first row" was previously whatever came back.
  const battles = ((battleRows ?? []) as BattleRow[]).sort((a, b) => a.id.localeCompare(b.id))
  if (battles.length === 0) return null
  // Disambiguate by where the party stands; else the sole row; else the lowest id.
  const locId = state.scene?.locationId ?? null
  const here = battles.filter((b) => b.location_id && b.location_id === locId)
  const battle = here[0] ?? battles[0]
  const enemies = parseEnemies(battle.spec)
  if (enemies.length === 0) return null

  const pcIds = await activePcIds(service, adventureId)
  if (pcIds.length === 0) return null

  const [{ data: npcRows }, { data: partyRows }, { data: adventure }] = await Promise.all([
    service.from('npcs').select('id, name, role, stat_block').eq('adventure_id', adventureId).not('stat_block', 'is', null),
    service.from('characters').select('id, name, level, class_key, abilities, ability_bonuses, hp_max, hp_current').in('id', pcIds),
    service.from('adventures').select('difficulty_setting').eq('id', adventureId).maybeSingle(),
  ])

  let battleMap: BattleMapRow | null = null
  if (battle.battle_map_id) {
    const { data } = await service
      .from('battle_maps')
      .select('id, grid_cols, grid_rows, obstacles, spawns')
      .eq('id', battle.battle_map_id)
      .maybeSingle()
    battleMap = (data as BattleMapRow | null) ?? null
  }

  // class_key is load-bearing, not decoration: without it every PC drops to unarmoured 10 + DEX,
  // and characterToSetup measures each point of AC at roughly +8 points of party win rate. The
  // live path omitted it while the Lab passed it, so a fighter fought the same encounter at AC 11
  // in a session and AC 18 in rehearsal. hp_current (not hp_max) so a party carrying damage into a
  // fight brings it - today nothing writes it, and the fallback keeps that a no-op.
  const party: PartyMemberInput[] = ((partyRows ?? []) as PartyRow[]).map((c) => ({
    id: c.id,
    name: c.name,
    level: c.level,
    classKey: c.class_key,
    abilities: c.abilities,
    abilityBonuses: c.ability_bonuses,
    hpMax: c.hp_current ?? c.hp_max,
  }))
  if (party.length === 0) return null

  const npcs: ManifestNpcRow[] = ((npcRows ?? []) as NpcJoinRow[]).map((n) => ({
    id: n.id,
    name: n.name,
    role: n.role === 'boss' ? 'boss' : 'npc',
    statBlock: n.stat_block ?? deriveNpcStatBlock(null, n.role === 'boss' ? 'boss' : 'npc'),
  }))

  const preset = asRecord((adventure as { difficulty_setting?: unknown } | null)?.difficulty_setting).preset
  const map = toMapInput(battleMap)

  const manifest = buildManifest({
    encounterId: battle.id,
    enemies,
    npcs,
    party,
    map,
    // The boss the CALLER identified from the beat's authored cast. Without it a boss is marked
    // only when a role='boss' npc happens to be named in spec.enemies, so a climax could be won
    // with bossOutcome 'none' and no npcStates write - the 2026-07-24 regression, on the path that
    // replaced the placeholder that caused it.
    bossNpcId: bossNpcId ?? null,
    baselinePreset: typeof preset === 'string' ? preset : 'standard',
    // F09 SS7.1 per-encounter intensity is not authored anywhere yet; the baseline preset is the
    // only difficulty signal that exists. Left explicit so it reads as unimplemented, not omitted.
    intensity: 0,
    beatSpec,
  })

  if (!battleMap) {
    manifest.warnings.push(battle.battle_map_id
      ? 'Assigned battle map could not be loaded; fought on an open field.'
      : 'No battle map assigned to this encounter; fought on an open field.')
  }
  if (here.length > 1 || (here.length === 0 && battles.length > 1)) {
    manifest.warnings.push(
      `${battles.length} battle encounters share this objective; picked ${battle.id} by ` +
        `${here.length > 0 ? 'location then id' : 'id'}.`,
    )
  }

  // Boss (if any) is auto-marked by buildManifest when a role='boss' npc is named in spec.enemies.
  const bossSetup = manifest.bossRef ? manifest.enemies.find((e) => e.id === manifest.bossRef) : null
  const boss = bossSetup && bossSetup.refId ? { id: bossSetup.refId, name: bossSetup.name } : null
  return { manifest, boss }
}

/** Run a built manifest to completion headless (single-writer, seeded) -> CombatResult. */
function resolveManifest(manifest: CombatManifest): { result: CombatResult; seed: number; rounds: number } {
  const seed = Math.floor(Math.random() * 0x7fffffff)
  const rng = seededRng(seed)
  let { state } = createCombat(manifestToSetup(manifest), rng)
  for (let i = 0; i < RESOLVE_TURN_CAP && !fightIsOver(state, manifest.bossRef); i++) {
    state = runAutoTurn(state, rng).state
  }
  return { result: deriveResult(state, { bossRef: manifest.bossRef }), seed, rounds: state.round }
}

/**
 * Join + resolve. Pure of spine calls - the caller does applyNpcState + resolveOpenEncounter. Any
 * gap (no authored fight, no party) returns null; a thrown engine/build error propagates so the
 * caller can catch it and fall back to the placeholder auto-win.
 */
export async function resolveLiveCombat(
  service: SupabaseClient,
  env: { adventureId: string },
  state: GameState,
  beatSpec: BeatSpecInput,
  opts?: { bossNpcId?: string | null },
): Promise<LiveCombatResult | null> {
  const built = await buildLiveManifest(service, env.adventureId, state, beatSpec, opts?.bossNpcId ?? null)
  if (!built) return null
  const { result, seed, rounds } = resolveManifest(built.manifest)
  return { result, boss: built.boss, encounterId: built.manifest.encounterId, seed, rounds, warnings: built.manifest.warnings }
}
