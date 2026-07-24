// NPC state transitions as CHANGES OF KIND, not flags on a row (2026-07-23, user's design).
//
// The bug this replaces: one `npcs` row carried a mutable `state`, so the same identity meant
// "living agent" and later "dead thing". Every consumer then had to reason about which - and
// the consistency checker could not. It read the narrator describing corpses ("the fallen
// agents lie sprawled", "their bodies now still and cold") as the dead ACTING, and turned real
// prose into the mechanical fallback. Removing the restriction hid that; it did not fix it.
//
// The model instead: an NPC is ALWAYS a living agent. When one dies the agent leaves the
// roster and a PROP enters the world - a body is an item. An item has no speech, no life
// state, and cannot be contradicted by being described. Anything that comes BACK changed (a
// ghost, a risen corpse, a possessed body) is a NEW agent with its own identity, created
// through the planner's existing `create_npcs` path - never the old row reanimated.
//
// `npcStates` still records 'dead' because ending signals and the staging filter key on it;
// what changes is that the world now also contains the body as a thing.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import { isGroupName } from '../_shared/guide/group-npcs.ts'
import type { EncounterSpec } from '../_shared/guide/group-npcs.ts'
import { corpsePropText, scenePropsAt } from '../_shared/story/index.ts'
import type { PropRow } from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

export type NpcTransition = 'dead' | 'absent' | 'alive'

/** Props the party can see here. Bodies, and anything else physical play leaves behind. */
export interface SceneProp {
  id: string
  text: string
}

/**
 * Applies a state transition and materializes its physical consequence. The ONLY place that
 * should write `npcStates` - so the corpse-prop invariant cannot be bypassed by a new caller.
 */
export async function applyNpcState(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  npc: { id: string; name: string },
  state: NpcTransition,
  source: string,
  evidence?: string,
): Promise<void> {
  const before = (await loadState(service, env.adventureId)).state
  const previous = before.dm?.facts.npcStates?.[npc.id] ?? 'alive'
  if (previous === state) return // nothing changed; do not re-log or re-body

  // A row that is also a GROUP of enemies is a TYPE, not a person, and life state is meaningless
  // for it. Live 2026-07-23: "Thorne's Agent" was authored as an NPC and ALSO listed as
  // `enemies: [{name: "Thorne's Agent", count: 2}]`. The party killed one, the ledger marked
  // the row dead; another walked into the next scene, the ledger marked it alive again - eight
  // writes and a resurrection for one row, because one identity was standing in for many
  // interchangeable people. The guide states the count, so this is arithmetic, not a judgement:
  // you cannot give a single life state to a thing there are several of. count >= 2 is the line -
  // a SOLO enemy (count 1) is one being that also fights (a boss, a duelist) and keeps its state.
  if (await npcIsGroup(service, env.adventureId, npc.name)) {
    await logEvent(service, env.adventureId, sessionId, 'npc_state_skipped', {
      npc_id: npc.id, name: npc.name, state, source, reason: 'creature_type',
    })
    return
  }

  await commitDiffs(service, env.adventureId, () => [
    { domain: 'dm', patch: { facts: { npcStates: { [npc.id]: state } } } },
  ])
  await logEvent(service, env.adventureId, sessionId, 'npc_state_recorded', {
    npc_id: npc.id, name: npc.name, state, source,
    ...(evidence ? { evidence: evidence.slice(0, 200) } : {}),
  })

  // Death leaves something behind - once. Keyed on the BODY already existing rather than on the
  // transition: `dead -> alive -> dead` re-armed a transition-only guard and produced two
  // corpses for one man, in two different rooms (live 2026-07-23).
  if (state === 'dead' && previous !== 'dead' && !(await hasCorpseProp(service, env.adventureId, npc.id))) {
    await createCorpseProp(service, env, sessionId, npc, before.scene.locationId ?? null)
  }
}

/**
 * Is this name fielded as a GROUP - a countable enemy of count >= 2 - anywhere in the guide? A
 * thing there are several of is a TYPE, not a person: it gets no single life state here, and no
 * staging slot or voice (guarded in social-staging.ts). Matching is plural-tolerant, so the npc
 * "Thorne's Agents" is caught by the enemy "Thorne's Agent". Shared with the guide pipeline's
 * build-time reclassification, which makes the same call over the whole roster.
 */
export async function npcIsGroup(
  service: SupabaseClient,
  adventureId: string,
  name: string,
): Promise<boolean> {
  const { data } = await service
    .from('encounters')
    .select('spec')
    .eq('adventure_id', adventureId)
  const encounters = ((data ?? []) as unknown as { spec: EncounterSpec | null }[]).map((row) => row.spec ?? {})
  return isGroupName(name, encounters)
}

async function hasCorpseProp(
  service: SupabaseClient,
  adventureId: string,
  npcId: string,
): Promise<boolean> {
  const { data } = await service
    .from('ingredients')
    .select('id')
    .eq('adventure_id', adventureId)
    .eq('type', 'item')
    .eq('content->>prop', 'corpse')
    .eq('content->>npc_id', npcId)
    .limit(1)
  return (data ?? []).length > 0
}

/**
 * The body, as an item in the world. Deterministic text - code owns the identity of the thing;
 * the narrator owns how it is described.
 */
async function createCorpseProp(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  npc: { id: string; name: string },
  locationId: string | null,
): Promise<void> {
  const text = corpsePropText(npc.name)
  const { data, error } = await service
    .from('ingredients')
    .insert({
      adventure_id: env.adventureId,
      type: 'item',
      content: { text, prop: 'corpse', npc_id: npc.id } as unknown as Json,
      placement: (locationId ? { location_id: locationId } : {}) as unknown as Json,
      reveals: `${npc.name} is dead - the body is here to be examined.`,
      // Already in front of the party: they saw it happen. Not a clue to be found.
      discovered: true,
      canon_source: 'generated',
    })
    .select('id')
    .single()
  if (error) {
    // Never block a death on its prop - the state change is the load-bearing half.
    console.error('corpse prop insert failed', error)
    return
  }
  await logEvent(service, env.adventureId, sessionId, 'prop_created', {
    prop: 'corpse', ingredient_id: data.id, npc_id: npc.id, name: npc.name, location_id: locationId,
  })
}

/** Props physically present where the party stands - describable things, never agents. */
export async function scenePropsHere(
  service: SupabaseClient,
  adventureId: string,
  locationId: string | null,
): Promise<SceneProp[]> {
  const { data } = await service
    .from('ingredients')
    .select('id, content, placement')
    .eq('adventure_id', adventureId)
    .eq('type', 'item')
    .eq('discovered', true)
  // Filtering rules (prop-marker only, location scoping) live in the pure module so they are
  // unit-tested without a database - see packages/rules/src/story/props.ts.
  return scenePropsAt((data ?? []) as PropRow[], locationId)
    .map((p) => ({ id: p.id, text: p.text }))
}
