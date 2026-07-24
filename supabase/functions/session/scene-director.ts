// Scene Director v1 (MAIN-SPEC F14 "automated scene-mode transitions"): applies the
// Adjudicator's scene_effects proposal. Every effect is validated against the registry and
// executed through the same DM-guarded actions a human DM uses (setScene, and startSocial via
// the injected callback - injection keeps this module out of the NPC pipeline's import graph)
// with the creator's authority. Full-AI only; assist keeps the human DM as the sole scene driver.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { AgentEnv, SceneEffects } from './agents.ts'
import { maybeSpawnEncounter } from './danger.ts'
import { spawnInstantiator } from './encounters.ts'
import { applyMilestones } from './milestones.ts'
import { appendLinesDiff, newLine } from './orchestrate.ts'
import { setScene } from './state.ts'
import { antagonistTurn } from './steward.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

export interface AppliedSceneEffects {
  traveledTo: string | null
  staged: string[]
  /** New in-game day number when the effect ticked the world clock; null otherwise. */
  dayAdvanced: number | null
  /** Placeholder-combat label when a fight was auto-resolved as a party victory. */
  combatWon: string | null
  /** The staged social scene was closed (explicit end_scene, or implied by travel). */
  sceneEnded: boolean
}

export type StageNpcsFn = (npcIds: string[]) => Promise<{ status: number; body: Record<string, unknown> }>
export type EndSceneFn = () => Promise<{ status: number; body: Record<string, unknown> }>

/** DM-guarded actions the Scene Director drives, injected to keep this module out of the NPC
 *  pipeline's import graph. */
export interface SceneHooks {
  stageNpcs: StageNpcsFn
  endScene: EndSceneFn
}

function matchByName<T extends { name: string }>(rows: T[], proposal: string): T | null {
  const norm = (s: string) => s.toLowerCase().trim()
  const wanted = norm(proposal)
  return (
    rows.find((r) => norm(r.name) === wanted) ??
    rows.find((r) => norm(r.name).includes(wanted) || wanted.includes(norm(r.name))) ??
    null
  )
}

export async function applySceneEffects(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  effects: SceneEffects,
  hooks: SceneHooks,
): Promise<AppliedSceneEffects> {
  const applied: AppliedSceneEffects = { traveledTo: null, staged: [], dayAdvanced: null, combatWon: null, sceneEnded: false }

  // Departing or concluding closes the staged social scene first - travel implies it, or the
  // roleplay gravity well never releases (nothing else ends a scene in full-AI).
  if (effects.endScene || effects.travelLocation) {
    const state = (await loadState(service, env.adventureId)).state
    if (state.dialogue.speakers.length > 0) {
      const result = await hooks.endScene()
      if (result.status === 200) applied.sceneEnded = true
    }
  }

  if (effects.travelLocation) {
    const { data, error } = await service.from('locations').select('id, name').eq('adventure_id', env.adventureId)
    assertOk(error, 'locations load failed')
    const match = matchByName((data ?? []) as { id: string; name: string }[], effects.travelLocation)
    if (match) {
      const result = await setScene(service, env.adventureId, env.creatorId, { location_id: match.id })
      if (result.status === 200) {
        applied.traveledTo = match.name
        await logEvent(service, env.adventureId, sessionId, 'scene_travel', {
          location_id: match.id, name: match.name, proposed: effects.travelLocation,
        })
        // Transition point (Slice 6): the road pushes back sometimes.
        await maybeSpawnEncounter(service, env, sessionId, 'scene_travel', spawnInstantiator(service, env, sessionId))
      }
    } else {
      await logEvent(service, env.adventureId, sessionId, 'scene_effect_rejected', {
        effect: 'travel', proposed: effects.travelLocation,
      })
    }
  }

  if (effects.stageNpcs.length > 0) {
    const { data, error } = await service.from('npcs').select('id, name').eq('adventure_id', env.adventureId)
    assertOk(error, 'npcs load failed')
    const rows = (data ?? []) as { id: string; name: string }[]
    const matches = [...new Map(
      effects.stageNpcs
        .map((name) => matchByName(rows, name))
        .filter((m): m is { id: string; name: string } => m !== null)
        .map((m) => [m.id, m]),
    ).values()].slice(0, 3)
    if (matches.length > 0) {
      const result = await hooks.stageNpcs(matches.map((m) => m.id))
      if (result.status === 200) applied.staged = matches.map((m) => m.name)
    } else {
      await logEvent(service, env.adventureId, sessionId, 'scene_effect_rejected', {
        effect: 'stage_npcs', proposed: effects.stageNpcs,
      })
    }
  }

  if (effects.encounter) {
    // Combat placeholder (pre-Phase 7): mark the encounter visibly in the transcript and the
    // event log, auto-resolve it as a decisive party victory, and record a story marker so
    // beat/objective predicates can key on it. The real combat engine replaces this block.
    const label = effects.encounter
    await logEvent(service, env.adventureId, sessionId, 'encounter_started', {
      kind: 'combat', label, placeholder: true,
    })
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(null, null, `Combat: ${label} - party victorious (placeholder auto-resolve)`)]),
    ])
    await logEvent(service, env.adventureId, sessionId, 'encounter_resolved', {
      kind: 'combat', label, victory: true, placeholder: true,
    })
    // narrative_marker, not story_event (Phase 1): the free-text tag never matched an authored
    // {event} atom except by string luck, and a lucky match would be UNAUTHORED progression.
    // Progression from combat flows through the beat's outcome map; this is transcript color.
    await logEvent(service, env.adventureId, sessionId, 'narrative_marker', {
      tag: `combat victory: ${label}`, source: 'encounter_placeholder',
    })
    applied.combatWon = label
  }

  if (effects.milestones.length > 0) {
    await applyMilestones(service, env, sessionId, effects.milestones, 'adjudicator')
  }

  if (effects.markEvent) {
    // The adjudicator's mark_event was the last schema-open door into the {event} namespace:
    // a free string logged as story_event could satisfy an authored event atom by exact-string
    // coincidence - progression by luck, invisible to every menu. Route it through the same
    // gate as milestones: resolves to an authored atom -> credited properly (validated,
    // idempotent, logged); doesn't -> narrative_marker, which evaluation never reads.
    const credited = await applyMilestones(service, env, sessionId, [effects.markEvent], 'adjudicator_mark_event')
    if (credited.length === 0) {
      await logEvent(service, env.adventureId, sessionId, 'narrative_marker', {
        tag: effects.markEvent, source: 'adjudicator',
      })
    }
  }

  if (effects.loud) {
    // Noise raises the danger score AND is itself a transition point (Slice 6).
    await logEvent(service, env.adventureId, sessionId, 'loud_action', { source: 'adjudicator' })
    await maybeSpawnEncounter(service, env, sessionId, 'loud_action', spawnInstantiator(service, env, sessionId))
  }

  if (effects.advanceDay) {
    // Mid-session world clock: significant time passing gives the antagonist their turn -
    // the world moves while the party travels/rests, same as the DM advance_day command.
    const after = await commitDiffs(service, env.adventureId, (s) => [
      { domain: 'scene', patch: { day: s.scene.day + 1 } },
    ])
    applied.dayAdvanced = after.state.scene.day
    await logEvent(service, env.adventureId, sessionId, 'day_advanced', {
      day: after.state.scene.day, source: 'adjudicator',
    })
    try {
      await antagonistTurn(service, env, sessionId, 'time_passed')
    } catch (err) {
      console.error('antagonist turn on day advance failed', err)
    }
    await maybeSpawnEncounter(service, env, sessionId, 'advance_day', spawnInstantiator(service, env, sessionId))
  }

  return applied
}

// milestoneVocabulary/applyMilestones moved to milestones.ts (Slice 6, import-graph hygiene).
// The transcript milestone recognizer that lived here was removed with the encounter-states
// machine (Slice 3): outcome maps and in-encounter adjudicator claims are the only
// progression writers. If a milestone can only be reached through free-form fiction, that is
// an authoring bug - route it through an encounter outcome map.
