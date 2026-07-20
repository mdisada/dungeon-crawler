// Random encounters (encounter-states Slice 6): the world pushes back, legibly. Rolls happen
// only at transition points (travel, day advance, encounter failure, loud actions), with a
// seeded RNG and a logged random_encounter_roll event carrying the score, roll, threshold,
// and table pick - the debug tab can always show why. Spawn instantiation is injected so
// this module stays a leaf in the import graph.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  dangerScore, fallbackEncounterTable, parseEncounterTable, pickWeighted, rollSpawn, seededRng,
} from '../_shared/play/index.ts'
import type { EncounterTableEntry } from '../_shared/play/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { assertOk, loadState, logEvent } from './util.ts'

export type SpawnTrigger = 'scene_travel' | 'advance_day' | 'encounter_failure' | 'loud_action'

export type SpawnInstantiator = (entry: EncounterTableEntry) => Promise<void>

const NOISE_WINDOW_MS = 10 * 60_000

/**
 * Scores the current location, rolls the spawn (seeded on the last event id), logs the roll,
 * and instantiates the picked table entry via the injected callback. Demo adventures spawn
 * deterministically (score >= 5, no dice) so the $0 suites stay reproducible. Never spawns
 * on top of an already-interrupted encounter (single-depth stack).
 */
export async function maybeSpawnEncounter(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  trigger: SpawnTrigger,
  instantiate: SpawnInstantiator,
): Promise<boolean> {
  const state = (await loadState(service, env.adventureId)).state
  if (state.encounter?.interrupted) return false

  const locationId = state.scene.locationId
  const { data: location } = locationId
    ? await service.from('locations').select('name, danger, encounter_table').eq('id', locationId).maybeSingle()
    : { data: null }
  const base = typeof location?.danger === 'number' ? location.danger : 0

  const { data: meta } = await service
    .from('meta_loop')
    .select('antagonist_plan')
    .eq('adventure_id', env.adventureId)
    .maybeSingle()
  const antagonistStep = Number(
    ((meta?.antagonist_plan ?? {}) as Record<string, Json>).current_step ?? 0,
  ) || 0

  const since = new Date(Date.now() - NOISE_WINDOW_MS).toISOString()
  const { count: noiseCount, error: noiseError } = await service
    .from('event_log')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId)
    .eq('type', 'loud_action')
    .gte('created_at', since)
  assertOk(noiseError, 'noise events load failed')

  // No day/night clock yet - night stays false until the world clock grows hours.
  const score = dangerScore(base, { night: false, antagonistStep, noiseEvents: noiseCount ?? 0 })

  const { data: lastEvent } = await service
    .from('event_log')
    .select('id')
    .eq('adventure_id', env.adventureId)
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const seed = Number(lastEvent?.id ?? 1) * 31 + state.scene.day
  const rng = seededRng(seed)
  const { roll, threshold, spawned } = env.demo
    ? { roll: 0, threshold: spawnedDemoThreshold(score), spawned: score >= 5 }
    : rollSpawn(rng, score)

  const table = parseEncounterTable((location?.encounter_table ?? null) as Json | null)
  const entries = table.length > 0 ? table : fallbackEncounterTable(location?.name ?? state.scene.locationName)
  const pick = spawned ? (env.demo ? entries[0] : pickWeighted(rng, entries)) : null

  await logEvent(service, env.adventureId, sessionId, 'random_encounter_roll', {
    trigger, score, roll, threshold, spawned,
    location: location?.name ?? state.scene.locationName ?? null,
    fallback_table: table.length === 0,
    pick: pick ? { kind: pick.kind, label: pick.label } : null,
  })
  if (!pick) return false
  await instantiate(pick)
  return true
}

function spawnedDemoThreshold(score: number): number {
  return score >= 5 ? 100 : 0
}
