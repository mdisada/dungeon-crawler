// Runtime half of the authored story graph (overhaul 2026-07-26): open the node the guide
// already authored, instead of planning a fresh beat with two LLM calls every time.
//
// Everything the old planner did per turn - invent a beat, design its encounter, map its outcome
// tiers, register its atoms, then repair its alignment - happened at guide time and was proved
// finishable by the reachability gate. What is left here is a lookup, a row insert, and the same
// cutscene narration the planner already used.
//
// Deliberately imports NOTHING from beats.ts: the caller (beats.ts) owns loop loading and passes
// the context in, so the module graph stays acyclic (import/no-cycle).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { advanceBeat } from '../_shared/story/index.ts'
import type { CoreLoop } from '../_shared/story/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { parseStoredBeatSpec, runCombatPlaceholderEncounter } from './encounters.ts'
import { graphDecision } from './graph-read.ts'
import type { AuthoredNodeRow } from './graph-read.ts'
import { narrationBeat } from './narration.ts'
import { assertOk, commitDiffs, logEvent } from './util.ts'

export interface OpenNodeContext {
  loop: CoreLoop
  loops: CoreLoop[]
  beatCount: number
  isClimax: boolean
  combatCount: number
  combatBudget: number
  /** Extra narration framing from the caller (rung delivery, climax pitch). */
  narrationContext?: string
  trigger: string
}

/**
 * Instantiate an authored node as the live beat: same `beats` row shape the planner produced
 * (so route-health, the lab inspector and openBeatSpec need no changes), plus `node_id` linking
 * back to what authored it.
 */
export async function openAuthoredNode(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  node: AuthoredNodeRow,
  arrivalContext: string,
  ctx: OpenNodeContext,
  persist: (before: CoreLoop[], after: CoreLoop[]) => Promise<void>,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { error: closeError } = await service
    .from('beats').update({ status: 'completed' }).eq('core_loop_id', ctx.loop.id).eq('status', 'active')
  assertOk(closeError, 'beat close failed')

  // The stored spec travels verbatim - its outcome maps were authored against the registry and
  // lint-proved, so nothing here may rewrite them. `node_key` rides along so the resolution
  // event can tell the navigator which edge to follow next.
  const spec = node.spec ? { ...node.spec, node_key: node.key } : null
  const { data: beatRow, error: beatError } = await service
    .from('beats')
    .insert({
      core_loop_id: ctx.loop.id,
      index: ctx.beatCount,
      name: node.label || node.key,
      goals: [node.narrationSeed] as unknown as Json,
      // `beats.exit_conditions` is NOT NULL default '[]' - passing an explicit null overrides the
      // default and violates the constraint, which failed EVERY beat insert on the first live run
      // (beat_open_failed -> route_health 'missing' -> director_replan_failed, no beat ever opened).
      // An authored node exits through its transitions, so an empty predicate is the honest value.
      exit_conditions: [] as unknown as Json,
      ingredient_requests: [] as unknown as Json,
      encounter_spec: spec as unknown as Json,
      node_id: node.id,
      status: 'active',
    })
    .select('id')
    .single()
  assertOk(beatError, 'beat insert failed')

  const advanced = advanceBeat(ctx.loops, ctx.loop.id, beatRow.id as string)
  if (advanced.ok) await persist(ctx.loops, advanced.loops)

  // Publish the node's authored ways in as choice chips. They are suggestions beside the free-text
  // box, and the encounter open path clears them (once you are IN the scene, the encounter frame
  // is what tells you how to engage).
  await commitDiffs(service, env.adventureId, () => [
    {
      domain: 'dialogue' as const,
      patch: { suggestedChoices: node.affordances.map((a) => ({ key: a.key, label: a.label, hint: a.hint })) } as unknown as Json,
    },
  ]).catch((err) => console.error('suggested choices publish failed', err))

  await logEvent(service, env.adventureId, sessionId, 'beat_opened', {
    core_loop_id: ctx.loop.id, beat_id: beatRow.id, name: node.label, trigger: ctx.trigger,
    node_key: node.key, node_role: node.role,
    encounter_kind: node.kind, encounter_label: String(node.spec?.label ?? node.label),
    source: 'story_graph',
  })

  // The opening cutscene. `arrivalContext` is the authored, TIER-AWARE line for the edge the
  // party actually travelled - without it a beat reached by failing gets narrated from the
  // destination's neutral seed and reads as a success.
  const climaxFraming = ctx.isClimax
    ? 'THIS IS THE CLIMAX - the culmination the entire adventure has built toward. Pitch the ' +
      'stakes at their absolute peak. Frame this as the decisive, final moment - whatever its ' +
      'form: a confrontation, a desperate escape, a reckoning, an irreversible choice. '
    : ''
  const stakes = typeof node.spec?.stakes === 'string' ? node.spec.stakes : ''
  await narrationBeat(
    service, env, sessionId,
    `${ctx.narrationContext ? `${ctx.narrationContext} ` : ''}${arrivalContext ? `${arrivalContext} ` : ''}` +
      `${climaxFraming}Open this scene: ${node.narrationSeed} ` +
      'Pick up from where the party actually stands - never presume travel or actions they did not take.' +
      (node.spec
        ? ` Telegraph what lies ahead - "${String(node.spec.label ?? node.label)}"` +
          `${stakes ? ` (at stake: ${stakes})` : ''} - and make the closing ask invite the party into it.`
        : ''),
    'Beat opened',
    'exposition',
  )

  // A combat finale opens itself - the party should not have to guess to swing first (2026-07-24).
  if (!env.demo && ctx.isClimax && node.kind === 'combat' && spec && ctx.combatCount < ctx.combatBudget) {
    const parsed = parseStoredBeatSpec(spec as unknown as Json)
    if (parsed) {
      await runCombatPlaceholderEncounter(
        service, env, sessionId, parsed,
        'The party reaches the heart of the matter - the final confrontation is upon them.',
      ).catch((err) => console.error('climax combat open failed', err))
    }
  }

  return { status: 200, body: { ok: true, beat_id: beatRow.id, name: node.label, node_key: node.key } }
}

/** Everything the dispatcher needs to decide + open, in one call. Returns null when this
 *  adventure has no authored graph for the objective (legacy guide -> runtime planner). */
export async function navigateAndOpen(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  objectiveId: string,
  ctx: OpenNodeContext,
  persist: (before: CoreLoop[], after: CoreLoop[]) => Promise<void>,
  rung: 'replan_beat' | 'guaranteed_route' | null,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const read = await graphDecision(service, env.adventureId, objectiveId, rung)
  if (!read) return null
  const { nodes, used, decision } = read

  if (decision.action === 'resolve') {
    // Nothing to open: the graph says this objective is finished, one way or the other. The
    // progress head owns retiring it (it holds the ladder, the reveal order and the narration),
    // and it runs on the same pass - so this only records which way the graph landed.
    //
    // Two very different outcomes used to share one event name, and the healthy one is far more
    // common - so six `graph_navigation_exhausted` rows in the 2026-07-26 heist read as "the graph
    // ran dry" when every one of them was in fact a clean stop. `objective_done` is a scene won;
    // `exhausted` is every authored scene spent, which now resolves the objective the hard way
    // rather than stranding it.
    const type = decision.reason === 'objective_done'
      ? 'graph_navigation_stopped'
      : 'graph_navigation_exhausted'
    await logEvent(service, env.adventureId, sessionId, type, {
      objective_id: objectiveId, reason: decision.reason, outcome: decision.outcome,
      used: used as unknown as Json,
    }).catch(() => {})
    return { status: 200, body: { ok: true, navigated: false, reason: decision.reason, outcome: decision.outcome } }
  }

  const node = nodes.find((n) => n.key === decision.node.key)!
  return openAuthoredNode(service, env, sessionId, node, decision.arrivalContext, ctx, persist)
}
