// Replay sandbox (dev-only). Re-opens a FINISHED adventure so the real play screen can be driven
// against real, already-generated content - the point being to exercise the live combat
// integration and iterate on play UI without paying for a fresh playthrough.
//
// Everything here runs through the same code paths live play uses; the only thing this module
// adds is a way to REACH them without the AI beat planner:
//   - `enter`/`exit` flip the adventure between `completed` and `active`, because start_session
//     refuses a completed adventure (lifecycle.ts) and the lobby needs ready seats.
//   - `start_combat` opens an authored battle directly via startLiveCombat + openInteractiveCombat,
//     the exact pair runCombatPlaceholderEncounter uses, minus the narration beat (no AI spend).
//
// Service-role + email-allowlisted rather than RLS, the lab-inspect.ts pattern: this mutates an
// adventure's status, which no product surface should ever offer.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { startLiveCombat } from './combat.ts'
import { activeEncounter, newEncounter, openInteractiveCombat, openEncounter, specState } from './encounters.ts'
import type { StoredBeatSpec } from './encounters.ts'
import { loadContext, loadState, logEvent } from './util.ts'

const LAB_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']

type Result = { status: number; body: Record<string, unknown> }

const forbidden: Result = { status: 403, body: { error: 'Replay sandbox is not available for this account' } }

interface ObjectiveRow {
  id: string
  title: string | null
  encounter_ids: string[] | null
}

interface EncounterRow {
  id: string
  type: string
  spec: Json
  location_id: string | null
  battle_map_id: string | null
}

async function openSessionId(service: SupabaseClient, adventureId: string): Promise<string | null> {
  const { data } = await service
    .from('sessions')
    .select('id')
    .eq('adventure_id', adventureId)
    .is('ended_at', null)
    .maybeSingle()
  return (data?.id as string | undefined) ?? null
}

/**
 * The battles this adventure has authored, grouped by the objective that owns them - the picker
 * the dev panel needs, because startLiveCombat resolves a fight through the objective join and
 * a finished adventure's `objectives.currentId` points at whatever it ended on.
 */
async function listBattles(service: SupabaseClient, adventureId: string): Promise<Result> {
  const { data: objectives } = await service
    .from('objectives')
    .select('id, title, encounter_ids')
    .eq('adventure_id', adventureId)
  const rows = (objectives ?? []) as ObjectiveRow[]
  const allIds = [...new Set(rows.flatMap((o) => o.encounter_ids ?? []))]
  if (allIds.length === 0) return { status: 200, body: { battles: [] } }

  const { data: encounters } = await service
    .from('encounters')
    .select('id, type, spec, location_id, battle_map_id')
    .in('id', allIds)
    .eq('type', 'battle')
  const battles = (encounters ?? []) as EncounterRow[]
  const byId = new Map(battles.map((e) => [e.id, e]))

  const out = rows.flatMap((objective) =>
    (objective.encounter_ids ?? [])
      .map((id) => byId.get(id))
      .filter((e): e is EncounterRow => !!e)
      .map((encounter) => {
        const spec = (typeof encounter.spec === 'object' && encounter.spec !== null && !Array.isArray(encounter.spec)
          ? encounter.spec
          : {}) as Record<string, Json>
        return {
          objective_id: objective.id,
          objective_title: objective.title ?? 'Untitled objective',
          encounter_id: encounter.id,
          label: typeof spec.label === 'string' && spec.label.trim() ? spec.label.trim() : 'Battle',
          has_map: encounter.battle_map_id !== null,
        }
      }),
  )
  return { status: 200, body: { battles: out } }
}

/** Flip a finished adventure back to playable, and re-ready the seats so start_session passes. */
async function enter(service: SupabaseClient, adventureId: string): Promise<Result> {
  const { error: statusError } = await service
    .from('adventures')
    .update({ status: 'active' })
    .eq('id', adventureId)
    .eq('status', 'completed')
  if (statusError) return { status: 500, body: { error: statusError.message } }

  const { data: seats, error: seatError } = await service
    .from('adventure_members')
    .update({ ready: true })
    .eq('adventure_id', adventureId)
    .eq('spectator', false)
    .not('character_id', 'is', null)
    .select('id')
  if (seatError) return { status: 500, body: { error: seatError.message } }

  await logEvent(service, adventureId, await openSessionId(service, adventureId), 'replay_entered', {
    seats: (seats ?? []).length,
  })
  return { status: 200, body: { ok: true, seats: (seats ?? []).length } }
}

/** Put the adventure back the way it was found. */
async function exit(service: SupabaseClient, adventureId: string): Promise<Result> {
  const { error } = await service
    .from('adventures')
    .update({ status: 'completed' })
    .eq('id', adventureId)
    .eq('status', 'active')
  if (error) return { status: 500, body: { error: error.message } }
  await logEvent(service, adventureId, null, 'replay_exited', {})
  return { status: 200, body: { ok: true } }
}

/**
 * Put an authored fight on the table. No narration beat and no story-progress pass - the fight
 * itself is what is under test, and the prose around it is what costs money. The fight resumes
 * and ends exactly as a planner-opened one does, through combat_action.
 */
async function startCombat(
  service: SupabaseClient,
  env: AgentEnv,
  objectiveId: string,
  label: string,
): Promise<Result> {
  const sessionId = await openSessionId(service, env.adventureId)
  if (!sessionId) return { status: 409, body: { error: 'No open session - start the session first' } }

  const state = (await loadState(service, env.adventureId)).state
  if (activeEncounter(state)) return { status: 409, body: { error: 'An encounter is already open' } }

  const spec: StoredBeatSpec = {
    kind: 'combat',
    label,
    stakes: 'Replay sandbox rehearsal.',
    params: {},
    onSuccess: [],
    onPartial: [],
    onFailure: [],
  }

  const started = await startLiveCombat(
    service,
    env,
    state,
    { label: spec.label, stakes: spec.stakes, onSuccess: [], onPartial: [], onFailure: [] },
    { objectiveId },
  )
  if (!started) {
    return {
      status: 409,
      body: {
        error:
          'Could not build the fight: the objective has no authored battle with enemies, or no ' +
          'seated character controls a party combatant.',
      },
    }
  }

  const encounter = newEncounter('combat', spec.label, spec.stakes, { replay: true })
  await openEncounter(service, env.adventureId, sessionId, encounter, specState(spec))
  await openInteractiveCombat(service, env, sessionId, spec, started)
  return { status: 200, body: { ok: true, encounter_id: encounter.id, combatants: started.engine.combatants.length } }
}

export async function replayControl(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  userEmail: string,
  body: Record<string, unknown>,
): Promise<Result> {
  if (!LAB_EMAILS.includes(userEmail.toLowerCase())) return forbidden
  if (!adventureId) return { status: 400, body: { error: 'adventure_id required' } }

  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isMember) return { status: 404, body: { error: 'Adventure not found' } }
  if (!ctx.isDm) return { status: 403, body: { error: 'Only the DM can drive a replay' } }

  const env: AgentEnv = {
    service,
    adventureId,
    creatorId: ctx.adventure.creator_id,
    demo: ctx.adventure.demo,
    mode: ctx.adventure.mode,
  }

  const command = String(body.replay_command ?? '')
  switch (command) {
    case 'enter':
      return enter(service, adventureId)
    case 'exit':
      return exit(service, adventureId)
    case 'battles':
      return listBattles(service, adventureId)
    case 'start_combat': {
      const objectiveId = String(body.objective_id ?? '')
      if (!objectiveId) return { status: 400, body: { error: 'objective_id required' } }
      const label = String(body.label ?? '').trim() || 'Rehearsal fight'
      return startCombat(service, env, objectiveId, label)
    }
    default:
      return { status: 400, body: { error: `Unsupported replay_command: ${command}` } }
  }
}
