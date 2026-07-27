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

/** locations.map jsonb -> ManifestMapInput, tolerating the legacy flat-spawn shape + missing grid. */
function toMapInput(locationId: string | null, rawMap: unknown): ManifestMapInput {
  const m = asRecord(rawMap)
  const cells = (v: unknown): Cell[] => (Array.isArray(v) ? v.filter(isCell) : [])
  const rawSpawns = m.spawns
  const spawns = Array.isArray(rawSpawns)
    ? { party: cells(rawSpawns), enemy: [] } // legacy flat spawns -> party side
    : { party: cells(asRecord(rawSpawns).party), enemy: cells(asRecord(rawSpawns).enemy) }
  return {
    mapId: locationId,
    obstacles: cells(m.obstacles),
    spawns,
    gridWidth: typeof m.gridCols === 'number' ? m.gridCols : 32,
    gridHeight: typeof m.gridRows === 'number' ? m.gridRows : 32,
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
  abilities: PartyMemberInput['abilities']
  ability_bonuses: PartyMemberInput['abilityBonuses']
  hp_max: number | null
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
    .select('id, type, spec, location_id')
    .in('id', encounterIds)
    .eq('type', 'battle')
  const battles = (battleRows ?? []) as BattleRow[]
  if (battles.length === 0) return null
  // Disambiguate by where the party stands; else the sole row; else the first.
  const locId = state.scene?.locationId ?? null
  const battle = battles.find((b) => b.location_id && b.location_id === locId) ?? battles[0]
  const enemies = parseEnemies(battle.spec)
  if (enemies.length === 0) return null

  const pcIds = await activePcIds(service, adventureId)
  if (pcIds.length === 0) return null

  const [{ data: npcRows }, { data: partyRows }, { data: adventure }] = await Promise.all([
    service.from('npcs').select('id, name, role, stat_block').eq('adventure_id', adventureId).not('stat_block', 'is', null),
    service.from('characters').select('id, name, level, abilities, ability_bonuses, hp_max').in('id', pcIds),
    service.from('adventures').select('difficulty_setting').eq('id', adventureId).maybeSingle(),
  ])

  let locationMap: unknown = null
  if (locId) {
    const { data: location } = await service.from('locations').select('map').eq('id', locId).maybeSingle()
    locationMap = (location as { map?: unknown } | null)?.map ?? null
  }

  const party: PartyMemberInput[] = ((partyRows ?? []) as PartyRow[]).map((c) => ({
    id: c.id, name: c.name, level: c.level, abilities: c.abilities, abilityBonuses: c.ability_bonuses, hpMax: c.hp_max,
  }))
  if (party.length === 0) return null

  const npcs: ManifestNpcRow[] = ((npcRows ?? []) as NpcJoinRow[]).map((n) => ({
    id: n.id,
    name: n.name,
    role: n.role === 'boss' ? 'boss' : 'npc',
    statBlock: n.stat_block ?? deriveNpcStatBlock(null, n.role === 'boss' ? 'boss' : 'npc'),
  }))

  const preset = asRecord((adventure as { difficulty_setting?: unknown } | null)?.difficulty_setting).preset
  const map = toMapInput(locId, locationMap)

  const manifest = buildManifest({
    encounterId: battle.id,
    enemies,
    npcs,
    party,
    map,
    baselinePreset: typeof preset === 'string' ? preset : 'standard',
    intensity: 0,
    beatSpec,
  })

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
): Promise<LiveCombatResult | null> {
  const built = await buildLiveManifest(service, env.adventureId, state, beatSpec)
  if (!built) return null
  const { result, seed, rounds } = resolveManifest(built.manifest)
  return { result, boss: built.boss, encounterId: built.manifest.encounterId, seed, rounds, warnings: built.manifest.warnings }
}
