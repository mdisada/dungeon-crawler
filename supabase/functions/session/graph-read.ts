// Reading the authored story graph, and nothing else (2026-07-27).
//
// Split out of graph-navigator.ts so the two consumers do not drag each other's dependencies
// around: OPENING a node needs the encounter and narration machinery, while DECIDING what happens
// next is four table reads and a pure function. progress.ts needs only the second half, and
// importing the first would have closed the loop progress -> graph-navigator -> encounters ->
// progress. This module imports no other session module, so it can never be part of a cycle.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { nextNode } from '../_shared/story/index.ts'
import type { NavNode, NavTier, NavigateResult } from '../_shared/story/index.ts'

/** One authored node, as stored. `spec` is the same shape beats.encounter_spec has always had. */
export interface AuthoredNodeRow {
  id: string
  key: string
  objectiveId: string
  index: number
  kind: 'skill_challenge' | 'social' | 'puzzle' | 'combat'
  role: 'route' | 'rescue'
  label: string
  narrationSeed: string
  spec: Record<string, unknown> | null
  affordances: { key: string; label: string; hint: string }[]
  transitions: { on: NavTier; toNodeKey: string | null; arrivalContext: string }[]
}

/** Pass or fail. A `partial` on a row written before 2026-07-27 reads as a pass, matching the
 *  social collapse - a partial was always a win that cost something. */
export function asTier(raw: unknown): NavTier {
  return raw === 'failed' ? 'failed' : 'full'
}

/** Every authored node serving one objective. Empty for legacy guides - the caller then falls
 *  back to the runtime planner (opening) or the completion predicate (progress). */
export async function loadObjectiveNodes(
  service: SupabaseClient,
  adventureId: string,
  objectiveId: string,
): Promise<AuthoredNodeRow[]> {
  const { data, error } = await service
    .from('story_nodes')
    .select('id, key, objective_id, index, kind, role, label, narration_seed, encounter_spec, affordances, transitions')
    .eq('adventure_id', adventureId)
    .eq('objective_id', objectiveId)
    .order('index')
  if (error) {
    console.error('story_nodes load failed', error)
    return []
  }
  return ((data ?? []) as Record<string, unknown>[]).map((n) => ({
    id: n.id as string,
    key: n.key as string,
    objectiveId: n.objective_id as string,
    index: Number(n.index ?? 0),
    kind: n.kind as AuthoredNodeRow['kind'],
    role: n.role === 'rescue' ? 'rescue' : 'route',
    label: (n.label as string) ?? '',
    narrationSeed: (n.narration_seed as string) ?? '',
    spec: (typeof n.encounter_spec === 'object' && n.encounter_spec !== null
      ? n.encounter_spec as Record<string, unknown>
      : null),
    affordances: (Array.isArray(n.affordances) ? n.affordances : []).flatMap((a) => {
      if (typeof a !== 'object' || a === null) return []
      const af = a as Record<string, unknown>
      return typeof af.key === 'string'
        ? [{ key: af.key, label: String(af.label ?? af.key), hint: String(af.hint ?? '') }]
        : []
    }),
    transitions: (Array.isArray(n.transitions) ? n.transitions : []).flatMap((t) => {
      if (typeof t !== 'object' || t === null) return []
      const tr = t as Record<string, unknown>
      return [{
        on: asTier(tr.on),
        toNodeKey: typeof tr.to_node_key === 'string' ? tr.to_node_key : null,
        arrivalContext: typeof tr.arrival_context === 'string' ? tr.arrival_context : '',
      }]
    }),
  }))
}

/**
 * Node keys already instantiated - `beats.node_id` is the record.
 *
 * Filtered by node id rather than by core_loop_id so this needs no loop context: the caller may be
 * the progress head, which has none. Node keys are objective-scoped by construction
 * (`obj:<uuid>#route0`), so there is nothing to scope further.
 */
export async function usedNodeKeys(
  service: SupabaseClient,
  nodes: readonly AuthoredNodeRow[],
): Promise<string[]> {
  if (nodes.length === 0) return []
  const { data, error } = await service.from('beats').select('node_id').in('node_id', nodes.map((n) => n.id))
  if (error) return []
  const usedIds = new Set(
    ((data ?? []) as { node_id: string | null }[]).map((b) => b.node_id).filter((id): id is string => Boolean(id)),
  )
  return nodes.filter((n) => usedIds.has(n.id)).map((n) => n.key)
}

/**
 * The node currently ON THE TABLE but not yet played out, if any.
 *
 * `usedNodeKeys` marks a node the moment its beat is inserted, which is right for navigation - a
 * scene already staged must never be re-opened. Reading that same mark as "played and lost" is
 * NOT right, and cost a live party their rescue scene (2026-07-27, The Salt-Wake Ledger): the
 * ladder's terminal opened, narrated, and was retired in the same tail because the resolution
 * pass saw three used nodes and no unplayed route. Bram never got to attempt it.
 *
 * A node is in play when its beat is active and no `encounter_resolved` has ever named it. That
 * covers the gap the `state.encounter` check misses entirely - a beat opens before its encounter
 * does, and the whole window in between looked like an empty table.
 */
export async function inPlayNodeKey(
  service: SupabaseClient,
  adventureId: string,
  nodes: readonly AuthoredNodeRow[],
): Promise<string | null> {
  if (nodes.length === 0) return null
  const byId = new Map(nodes.map((n) => [n.id, n.key]))
  const { data: beats } = await service
    .from('beats')
    .select('node_id')
    .in('node_id', [...byId.keys()])
    .eq('status', 'active')
    .limit(1)
  const activeKey = byId.get(((beats ?? [])[0]?.node_id ?? '') as string)
  if (!activeKey) return null

  const { data: events } = await service
    .from('event_log')
    .select('key:payload->>node_key')
    .eq('adventure_id', adventureId)
    .eq('type', 'encounter_resolved')
    .limit(200)
  const resolved = new Set(((events ?? []) as { key: string | null }[]).map((e) => e.key ?? ''))
  return resolved.has(activeKey) ? null : activeKey
}

/** The node/tier the party just came off, read from the encounter they last resolved. */
export async function lastResolvedNode(
  service: SupabaseClient,
  adventureId: string,
  nodes: readonly AuthoredNodeRow[],
): Promise<{ fromKey: string | null; tier: NavTier | null }> {
  const { data } = await service
    .from('event_log')
    .select('payload')
    .eq('adventure_id', adventureId)
    .eq('type', 'encounter_resolved')
    .order('created_at', { ascending: false })
    .limit(1)
  const payload = ((data ?? [])[0]?.payload ?? null) as Record<string, unknown> | null
  if (!payload) return { fromKey: null, tier: null }
  const nodeKey = typeof payload.node_key === 'string' ? payload.node_key : null
  if (!nodeKey || !nodes.some((n) => n.key === nodeKey)) return { fromKey: null, tier: null }
  return { fromKey: nodeKey, tier: asTier(payload.tier) }
}

export const toNavNodes = (nodes: readonly AuthoredNodeRow[]): NavNode[] =>
  nodes.map((n) => ({
    id: n.id, key: n.key, objectiveId: n.objectiveId, index: n.index, role: n.role, transitions: n.transitions,
  }))

/**
 * What the graph says should happen next for one objective, or null when this adventure has no
 * authored graph for it (legacy guide). Every caller of `nextNode` in the session goes through
 * here, so the navigator sees identical inputs whichever side asks.
 */
export async function graphDecision(
  service: SupabaseClient,
  adventureId: string,
  objectiveId: string,
  rung: 'replan_beat' | 'guaranteed_route' | null = null,
): Promise<{ nodes: AuthoredNodeRow[]; used: string[]; decision: NavigateResult } | null> {
  const nodes = await loadObjectiveNodes(service, adventureId, objectiveId)
  if (nodes.length === 0) return null

  const [used, last] = await Promise.all([
    usedNodeKeys(service, nodes),
    lastResolvedNode(service, adventureId, nodes),
  ])
  return {
    nodes,
    used,
    decision: nextNode({ nodes: toNavNodes(nodes), fromKey: last.fromKey, tier: last.tier, usedKeys: used, rung }),
  }
}
