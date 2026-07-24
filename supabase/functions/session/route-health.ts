// Beat liveness (overhaul Phase 3). Replaces progress.ts's beatHasNoRouteLeft, which could
// only see ONE failure shape: a beat whose encounter opened, resolved, and left the exit
// predicate unsatisfied. It required an `encounter_resolved` matching the beat's own label,
// which made it structurally blind to the worst case - an encounter that can never OPEN.
//
// Live 2026-07-22 (Below the Sunken Chapel): a social beat named a dead collective, staging
// refused, the encounter never opened, the beat was therefore never "spent", nothing ever
// re-planned it, and the objective became permanently unreachable. Four verdicts now:
//
//   healthy    - the beat has a route the party can still play
//   stillborn  - the beat's encounter has never opened and cannot be staged
//   spent      - its encounter opened and resolved without satisfying the exit
//   missing    - the loop has no active beat at all (planner failure, orphaned pointer)

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { stageableNpcs } from '../_shared/story/index.ts'
import type { NpcStageRow, RouteHealth } from '../_shared/story/index.ts'
import type { GameState, Json } from '../_shared/state/index.ts'

/**
 * The three fields liveness needs, read straight off the jsonb. Deliberately NOT
 * encounters.ts's parseStoredBeatSpec: importing it would close an encounters -> progress ->
 * route-health -> encounters module cycle, and this detector only cares about kind/label/params.
 */
function specSummary(raw: Json): { kind: string; label: string; params: Record<string, Json> } | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null
  const obj = raw as Record<string, Json>
  if (typeof obj.label !== 'string' || !obj.label.trim()) return null
  return {
    kind: typeof obj.kind === 'string' ? obj.kind : '',
    label: obj.label,
    params: (typeof obj.params === 'object' && obj.params !== null && !Array.isArray(obj.params)
      ? obj.params
      : {}) as Record<string, Json>,
  }
}

/** Turns a never-opened beat gets before it is judged stillborn rather than merely young. */
export const STILLBORN_GRACE_TURNS = 2

export interface RouteHealthInput {
  adventureId: string
  beatId: string | null
  beatStatus?: string | null
  encounterSpec: Json
  state: GameState
  /** Player turns since this beat opened - a young beat is not a broken one. */
  turnsSinceBeatOpened: number
}

export async function beatRouteHealth(
  service: SupabaseClient,
  input: RouteHealthInput,
): Promise<RouteHealth> {
  if (!input.beatId || input.beatStatus !== 'active') return 'missing'

  const spec = specSummary(input.encounterSpec)
  // A beat with no encounter at all is the planner's deterministic fallback: it degrades to
  // ad-hoc entries, which is playable. Not broken, just thin.
  if (!spec) return 'healthy'

  const { data: rows } = await service
    .from('event_log')
    .select('type, payload')
    .eq('adventure_id', input.adventureId)
    .in('type', ['beat_opened', 'encounter_opened', 'encounter_resolved'])
    .order('id')
  const events = (rows ?? []) as { type: string; payload: Record<string, unknown> | null }[]
  const openedAt = events.findIndex((e) => e.type === 'beat_opened' && e.payload?.beat_id === input.beatId)
  if (openedAt < 0) return 'healthy' // no record of this beat opening yet - too early to judge
  const since = events.slice(openedAt + 1)

  const label = spec.label
  const ownOpened = since.some((e) => e.type === 'encounter_opened' && e.payload?.label === label)
  const ownResolved = since.some((e) => e.type === 'encounter_resolved' && e.payload?.label === label)

  if (ownOpened) {
    if (!ownResolved) return 'healthy' // still being played
    // Its own route ran out; anything else still open means there IS something to do.
    const stillOpen = since.filter((e) => e.type === 'encounter_opened').length >
      since.filter((e) => e.type === 'encounter_resolved').length
    return stillOpen ? 'healthy' : 'spent'
  }

  // Never opened. Young beats are simply unplayed - the party may not have engaged yet.
  if (input.turnsSinceBeatOpened < STILLBORN_GRACE_TURNS) return 'healthy'

  // The one shape the old detector could not see: a SOCIAL encounter with nobody it can
  // stage. Checked structurally (registry + live npcStates), never by word signal.
  if (spec.kind === 'social') {
    const ids = Array.isArray(spec.params.npc_ids)
      ? (spec.params.npc_ids as Json[]).filter((v): v is string => typeof v === 'string')
      : []
    const names = Array.isArray(spec.params.npc_names)
      ? (spec.params.npc_names as Json[]).filter((v): v is string => typeof v === 'string')
      : []
    if (ids.length === 0 && names.length === 0) return 'stillborn'
    const { data: npcRows } = await service
      .from('npcs')
      .select('id, name, initial_state, generated')
      .eq('adventure_id', input.adventureId)
    const roster: NpcStageRow[] = ((npcRows ?? []) as {
      id: string; name: string; initial_state?: string | null; generated?: boolean | null
    }[]).map((n) => ({ id: n.id, name: n.name, initialState: n.initial_state, generated: n.generated }))
    const living = stageableNpcs(roster, input.state.dm?.facts.npcStates ?? {})
    const livingIds = new Set(living.map((n) => n.id))
    const norm = (s: string) => s.toLowerCase().trim()
    const reachable = ids.some((id) => livingIds.has(id)) ||
      names.some((n) => living.some((l) => norm(l.name) === norm(n) || norm(l.name).includes(norm(n))))
    if (!reachable) return 'stillborn'
  }

  return 'healthy'
}
