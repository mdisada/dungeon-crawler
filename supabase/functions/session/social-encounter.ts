// Social encounters (encounter-states Slice 4): conversations get goals and ends. The spec
// carries a goal, the NPCs to stage, and 2-4 authored exits mapped to result tiers; the
// existing NPC pipeline runs unchanged inside. After each NPC reply the narrow exit judge
// (never the open recognizer) checks the authored exits only; disposition <= -8 forces a
// hostile exit; a scene ending without an exit resolves as left_unresolved. NPC staging is
// injected (like SceneHooks) to keep this module out of the NPC pipeline's import graph.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { EncounterState, Json } from '../_shared/state/index.ts'
import { runSocialExitJudge } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import {
  activeEncounter, newEncounter, openEncounter, resolveOpenEncounter,
} from './encounters.ts'
import type { ResolutionTier, StoredBeatSpec } from './encounters.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

export interface SocialExit {
  outcome: string
  description: string
  tier: 'success' | 'partial' | 'failure'
}

/** Disposition at or below this forces a hostile (failure-tier) exit. */
export const HOSTILE_EXIT_THRESHOLD = -8

export function socialExits(params: Record<string, Json>): SocialExit[] {
  const raw = Array.isArray(params.exits) ? params.exits : []
  return raw.flatMap((e): SocialExit[] => {
    if (typeof e !== 'object' || e === null || Array.isArray(e)) return []
    const exit = e as Record<string, Json>
    if (typeof exit.outcome !== 'string' || !exit.outcome.trim()) return []
    const tier = exit.tier === 'partial' || exit.tier === 'failure' ? exit.tier : 'success'
    return [{
      outcome: exit.outcome.trim(),
      description: typeof exit.description === 'string' ? exit.description : '',
      tier,
    }]
  }).slice(0, 4)
}

const exitTier = (exit: SocialExit | null): ResolutionTier =>
  exit === null ? 'failed' : exit.tier === 'success' ? 'full' : exit.tier === 'partial' ? 'partial' : 'failed'

export type StageNpcsHook = (npcIds: string[]) => Promise<{ status: number; body: Record<string, unknown> }>

/**
 * Instantiates a social encounter: resolves the spec's NPCs against the registry, stages
 * them (existing startSocial), and opens the frame. Returns null when no NPC resolves -
 * the caller degrades to an ad-hoc entry instead of crashing the machine.
 */
export async function openSocialEncounter(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  spec: StoredBeatSpec,
  stageNpcs: StageNpcsHook,
): Promise<EncounterState | null> {
  const ids = Array.isArray(spec.params.npc_ids)
    ? (spec.params.npc_ids as Json[]).filter((v): v is string => typeof v === 'string')
    : []
  const wanted = Array.isArray(spec.params.npc_names)
    ? (spec.params.npc_names as Json[]).filter((v): v is string => typeof v === 'string')
    : []
  let npcIds = ids
  if (npcIds.length === 0 && wanted.length > 0) {
    const { data, error } = await service.from('npcs').select('id, name').eq('adventure_id', env.adventureId)
    assertOk(error, 'npcs load failed')
    const rows = (data ?? []) as { id: string; name: string }[]
    const norm = (s: string) => s.toLowerCase().trim()
    npcIds = [...new Set(wanted.flatMap((name) => {
      const match = rows.find((r) => norm(r.name) === norm(name)) ??
        rows.find((r) => norm(r.name).includes(norm(name)) || norm(name).includes(norm(r.name)))
      return match ? [match.id] : []
    }))].slice(0, 3)
  }
  if (npcIds.length === 0) {
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'social_encounter_no_npcs', label: spec.label, wanted: wanted as unknown as Json,
    })
    return null
  }
  const staged = await stageNpcs(npcIds)
  if (staged.status !== 200) {
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'social_encounter_stage_failed', label: spec.label, error: String(staged.body.error ?? ''),
    })
    return null
  }
  const goal = typeof spec.params.goal === 'string' ? spec.params.goal : ''
  const encounter = newEncounter('social', spec.label, spec.stakes, { goal, exchanges: 0 })
  await openEncounter(service, env.adventureId, sessionId, encounter, {
    onSuccess: spec.onSuccess, onPartial: spec.onPartial, onFailure: spec.onFailure, params: spec.params,
  })
  return encounter
}

/** One exchange = one NPC reply; the speaking PC's contribution feeds the teamwork ledger. */
export async function recordSocialExchange(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  actorCharacterId: string,
): Promise<void> {
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (encounter?.kind !== 'social') return
  const progress = (typeof encounter.progress === 'object' && encounter.progress !== null && !Array.isArray(encounter.progress)
    ? encounter.progress
    : {}) as Record<string, Json>
  const exchanges = (typeof progress.exchanges === 'number' ? progress.exchanges : 0) + 1
  await commitDiffs(service, env.adventureId, () => [
    {
      domain: 'encounter',
      patch: {
        progress: { exchanges },
        contributions: { [actorCharacterId]: (encounter.contributions[actorCharacterId] ?? 0) + 1 },
      },
    },
  ])
  await logEvent(service, env.adventureId, sessionId, 'encounter_attempt', {
    encounter_id: encounter.id, kind: 'social', character_id: actorCharacterId, exchanges,
  })
}

/**
 * Exit detection after an NPC reply: the disposition floor forces a hostile exit
 * deterministically; otherwise the narrow judge weighs the authored exits. Null = the
 * conversation continues.
 */
export async function detectSocialExit(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  stagedNpcIds: string[],
): Promise<{ exit: SocialExit | null; forced: boolean } | null> {
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (encounter?.kind !== 'social') return null
  const params = state.dm?.encounterSpec?.params
  const exits = socialExits((typeof params === 'object' && params !== null && !Array.isArray(params)
    ? params
    : {}) as Record<string, Json>)

  if (stagedNpcIds.length > 0) {
    const { data } = await service
      .from('npc_dispositions')
      .select('npc_id, value')
      .eq('adventure_id', env.adventureId)
      .in('npc_id', stagedNpcIds)
    const hostile = ((data ?? []) as { value: number }[]).some((d) => Number(d.value) <= HOSTILE_EXIT_THRESHOLD)
    if (hostile) {
      const exit = exits.find((e) => e.tier === 'failure') ?? null
      return { exit, forced: true }
    }
  }

  const goal = (typeof encounter.progress === 'object' && encounter.progress !== null && !Array.isArray(encounter.progress)
    && typeof (encounter.progress as Record<string, Json>).goal === 'string'
    ? (encounter.progress as Record<string, Json>).goal as string
    : '')
  const recent = state.dialogue.lines.slice(-8).map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`)
  const outcome = await runSocialExitJudge(env, goal, exits, recent)
  if (!outcome) return null
  return { exit: exits.find((e) => e.outcome === outcome) ?? null, forced: false }
}

/**
 * Resolution: outcome -> tier -> outcome map -> close -> progress pass -> narration hook,
 * all via the shared resolveOpenEncounter. A null exit is 'left_unresolved' (failure tier).
 */
export async function resolveSocialExit(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  exit: SocialExit | null,
  forced: boolean,
): Promise<void> {
  const state = (await loadState(service, env.adventureId)).state
  const encounter = activeEncounter(state)
  if (encounter?.kind !== 'social') return
  const outcome = exit?.outcome ?? 'left_unresolved'
  await logEvent(service, env.adventureId, sessionId, 'encounter_exit', {
    encounter_id: encounter.id, kind: 'social', outcome, forced, tier: exitTier(exit),
  })
  await resolveOpenEncounter(
    service, env, sessionId, exitTier(exit),
    `The conversation concluded: "${outcome}"${exit?.description ? ` - ${exit.description}` : ''}.` +
      (forced ? ' Tempers boiled over - the exit was forced, not chosen.' : ''),
  )
}
