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

import { advanceBeat, nodeBeatId } from '../_shared/story/index.ts'
import type { CoreLoop } from '../_shared/story/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { parseStoredBeatSpec, runCombatPlaceholderEncounter } from './encounters.ts'
import { applyMilestones } from './milestones.ts'
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
  /** Where the party is standing RIGHT NOW, so an unreached node is opened as a pull, not an
   *  arrival. Caller-supplied because this module stays acyclic and does not load state. */
  partyLocationId?: string | null
  partyLocationName?: string
  trigger: string
}

/**
 * A NODE THAT OPENS ALWAYS RESOLVES (2026-07-27).
 *
 * `beats.node_id` was carrying two meanings on two different clocks: "never re-open this scene",
 * which is true the moment the beat is inserted, and "this route is spent", which is only true
 * once the scene has been played. Wherever a beat was closed without a resolution the second
 * meaning became a lie - a route consumed for free, no setback written, no transition recorded,
 * and the node unofferable forever after.
 *
 * The fix is not to split the two meanings but to make them COINCIDE. Every path that replaces
 * the live beat funnels through the single close below, so recording the outgoing node's loss
 * here makes "a beat row exists" and "the scene was played" the same statement - for all seven
 * callers of planAndOpenBeat and any future one, rather than seven separate guards that each have
 * to remember.
 *
 * Live 2026-07-27: node #n0 opened and narrated, the party never engaged it, the director's rung 3
 * replanned past it, and it vanished with no event at all. Rung 4 is worse - it is gated on
 * `!state.encounter`, so it hits this case BY CONSTRUCTION every single time it fires.
 */
async function closeOutgoingNode(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  loopId: string,
  incomingNodeId: string,
  trigger: string,
): Promise<void> {
  const { data: outgoing } = await service
    .from('beats')
    .select('id, node_id, encounter_spec')
    .eq('core_loop_id', loopId)
    .eq('status', 'active')
    .not('node_id', 'is', null)
    .limit(1)
  const beat = (outgoing ?? [])[0] as { node_id: string; encounter_spec: Record<string, Json> | null } | undefined
  if (!beat || beat.node_id === incomingNodeId) return

  const spec = beat.encounter_spec ?? null
  const nodeKey = typeof spec?.node_key === 'string' ? spec.node_key : null
  if (!nodeKey) return

  // Already played out on its own terms - nothing to record.
  const { data: resolved } = await service
    .from('event_log')
    .select('id')
    .eq('adventure_id', env.adventureId)
    .eq('type', 'encounter_resolved')
    .eq('payload->>node_key', nodeKey)
    .limit(1)
  if ((resolved ?? []).length > 0) return

  // The setback fires. A scene the party loses - by failing it OR by walking away from it long
  // enough that the story moved on - must cost them something, or "losing" is free.
  const onFailure = Array.isArray(spec?.on_failure)
    ? (spec.on_failure as unknown[]).filter((a): a is string => typeof a === 'string')
    : []
  const applied = onFailure.length > 0
    ? await applyMilestones(service, env, sessionId, onFailure, 'encounter_outcome').catch(() => [])
    : []

  // Logged as a real resolution so the NAVIGATOR sees it: `lastResolvedNode` reads this, and the
  // node's authored failure edge is followed exactly as it would be after a lost roll. An
  // abandonment is a transition, not a hole.
  await logEvent(service, env.adventureId, sessionId, 'encounter_resolved', {
    node_key: nodeKey, tier: 'failed', abandoned: true, trigger,
    milestones: applied as unknown as Json,
  }).catch(() => {})
}

/**
 * What the last resolved scene left behind, as one sentence the next scene can open against.
 *
 * Only a FAILURE TRANSITION carries an authored bridge - the guide's `setback_line`, written for
 * exactly that edge (navigate.ts:128). Every other way a scene opens passes `arrivalContext: ''`:
 * a rescue, a director replan, an alternate route, the objective's first node. Measured across
 * three runs, NOT ONE beat opened through the transition path - every single scene in every run
 * began with no connection to the one before it.
 *
 * `outcome_summary` is what fills that gap. It was added at guide time to record what is TRUE after
 * a node resolves, win or loss, which is precisely what the next scene needs to open against.
 * Empty when the guide predates it, which degrades to the previous behaviour.
 */
async function bridgeFromLastResolution(
  service: SupabaseClient,
  adventureId: string,
): Promise<string> {
  const { data: events } = await service
    .from('event_log')
    .select('payload')
    .eq('adventure_id', adventureId)
    .eq('type', 'encounter_resolved')
    .order('id', { ascending: false })
    .limit(1)
  const payload = ((events ?? [])[0]?.payload ?? null) as { node_key?: string; tier?: string } | null
  if (!payload?.node_key) return ''
  const { data: node } = await service
    .from('story_nodes')
    .select('outcome_summary')
    .eq('adventure_id', adventureId)
    .eq('key', payload.node_key)
    .maybeSingle()
  const outcome = (node?.outcome_summary ?? null) as { win?: string; loss?: string } | null
  const text = payload.tier === 'full' ? outcome?.win : outcome?.loss
  return typeof text === 'string' ? text.trim() : ''
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
  await closeOutgoingNode(service, env, sessionId, ctx.loop.id, node.id, ctx.trigger)

  // The stored spec travels verbatim - its outcome maps were authored against the registry and
  // lint-proved, so nothing here may rewrite them. `node_key` rides along so the resolution
  // event can tell the navigator which edge to follow next.
  const spec = node.spec ? { ...node.spec, node_key: node.key } : null
  // CLAIM THE NODE FIRST (2026-07-27). The insert is the lock: `nodeBeatId` is derived from the
  // node, so a concurrent pass that picked the same node loses to the primary key here.
  //
  // Ordered BEFORE the close deliberately. Closing first would let a losing pass complete the
  // winner's freshly-inserted beat, leaving the loop pointing at a completed beat - route health
  // 'missing', and a re-plan of a scene that had just opened correctly.
  const beatId = nodeBeatId(node.id)
  const { data: beatRow, error: beatError } = await service
    .from('beats')
    .insert({
      id: beatId,
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
  if (beatError) {
    // Someone else instantiated this node between our navigation read and this write. It is the
    // SAME authored scene, so the right answer is to defer to it - never to open it twice.
    const { data: winner } = await service.from('beats').select('id').eq('id', beatId).maybeSingle()
    if (winner) {
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'beat_open_race', node_key: node.key, beat_id: beatId, trigger: ctx.trigger,
      }).catch(() => {})
      return { status: 200, body: { ok: true, beat_id: beatId, name: node.label, node_key: node.key, deduped: true } }
    }
    assertOk(beatError, 'beat insert failed')
  }

  // Every OTHER active beat on this loop now closes. Excluding our own row is what makes the
  // claim above hold - without it this statement would immediately undo it.
  const { error: closeError } = await service
    .from('beats').update({ status: 'completed' })
    .eq('core_loop_id', ctx.loop.id).eq('status', 'active').neq('id', beatId)
  assertOk(closeError, 'beat close failed')

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
  // ONE MENU, NOT TWO (2026-07-28). The affordances published as chips just above were never shown
  // to the narrator, so it invented its own ways in - and they disagreed with the chips on every
  // node of a live run: chips offered "persuade Tomalen / offer him coin" while the prose asked
  // "Are you going out there, then?". A player who follows the prose is typing something the scene
  // was not built to take, which is exactly the misfiling the entry mapper's audit trail measures.
  //
  // The single-way case matters most: node r0 had ONE authored affordance and the prose offered
  // three invented directions - the precise padding the exposition brief already forbids.
  //
  // ...but the cure became the disease (2026-07-28). Handing the narrator the affordance list and
  // saying "close on THESE" got them PASTED: 8% of published lines ended in an enumerated menu,
  // one of them the hints verbatim and in bold ("Perhaps a direct threat will break him."). The
  // player was reading the same three options twice - once as chips, once as DM notes wearing
  // prose. The affordances still travel, because inventing a fourth way was the original bug;
  // they are now framing for the scene's ending rather than the ending itself.
  // An authored setback line wins; otherwise fall back to what the last scene actually left behind.
  const bridge = arrivalContext || await bridgeFromLastResolution(service, env.adventureId)
  const ways = node.affordances.map((a) => a.hint || a.label).filter(Boolean)
  const waysLine = ways.length === 0
    ? ''
    : ` For your own framing only, the party can act on these and nothing else: ${ways.join('; ')}. ` +
      'Land the scene somewhere at least one of them is an obvious thing to reach for - but do ' +
      'NOT name, list or allude to them as options. They are already on the player\'s screen.'
  // NOT THERE YET (2026-07-28). A node now carries WHERE it happens, and until it did, a beat
  // whose scene sits somewhere else was opened as though the party had already walked in. Live
  // run 77451545: the beat "Attack Cael Wytherr to stop his writing" opened at 05:58:20 and
  // published "Bram kicks the sealed door inward" eight seconds later - the party travelled to
  // that office at 05:58:52, and the encounter then narrated the same door a second time.
  //
  // One clause telling the narrator not to presume travel could never win: every other line of
  // the prompt - the seed, the label, the stakes, the beat's own imperative name - describes the
  // scene as though it were underway. So when the place does not match, the instruction changes
  // shape entirely: this is a pull toward somewhere, not a scene being entered.
  const elsewhere = Boolean(node.locationId) && Boolean(ctx.partyLocationId) &&
    node.locationId !== ctx.partyLocationId
  // A node with no place at all: either a rescue node (unplaced by design - it happens wherever
  // the party stands) or a guide authored before placement existed. See the seed note below.
  const nodeIsUnplaced = !node.locationId
  const isRescueNode = /#r\d+$/.test(node.key)
  const standing = elsewhere
    ? `The party is NOT there - they are still at ${ctx.partyLocationName || 'where they were'}, ` +
      'and have taken no step toward it. Write only the pull: what reaches them from it where ' +
      'they stand - a sound, a rumour, a messenger, a change in the air. Do NOT place them in ' +
      'the scene, move them, or narrate any part of what happens once they arrive. '
    // NAME THE PLACE (2026-07-28). This branch used to say only "pick up from where the party
    // actually stands", which tells the narrator that its location matters without telling it what
    // the location IS - and an instruction with the datum missing is one the model has to fill in.
    //
    // Run 15fc82be is a clean contrast inside a single run. Three beats took the pull branch above,
    // which names the place ("they are still at Mirefall"), and all three stayed put. Narration #19
    // took THIS branch - a rescue node, whose location is null by design, so `elsewhere` is false -
    // and opened with "You come to on the slick stone floor of The Saltworks", moving the party 21
    // seconds before scene_travel fired. The scene it invented was the one the objective was named
    // after, which is exactly where a writer with no stated location would put them.
    : `The party is at ${ctx.partyLocationName || 'where they already are'} and has not moved - ` +
      'open the scene there, and never presume travel or actions they did not take. ' +
      // THE SEED MAY DISAGREE, AND IT WINS UNLESS TOLD OTHERWISE (2026-07-29).
      //
      // `elsewhere` keys on `node.locationId`, so a node with NO location takes this branch and is
      // told "the scene happens here" - while its authored seed may open on a named room the party
      // has never entered. The prompt then carries two contradictory instructions, and the seed
      // wins every time because it is concrete and vivid and comes first.
      //
      // Live run 5a5e6c7f, narration #8: the prompt said "Open this scene: Brenn Coale's cramped
      // tenement is a chaotic archive..." followed by "The party is at Harbourmaster's Office and
      // has not moved". The narrator reproduced the tenement verbatim, teleporting the party to a
      // room that is not even in the locations table.
      //
      // Guides authored before node placement (1e24291, mid-2026-07-28) have location_id NULL on
      // EVERY node - 0 of 12 on that adventure - so this is the whole of a legacy guide, not an
      // edge case. Rescue nodes are unplaced by design and their seeds are written generically, so
      // they neither need this nor are harmed by it.
      (nodeIsUnplaced && !isRescueNode
        ? 'The scene description above may name a room or building the party is NOT in - it was ' +
          'written without a place attached. Take its CONTENT (who is there, what is happening, ' +
          'what matters) and stage it where the party actually stands. Never reproduce its setting ' +
          'as though they had walked into it. '
        : '')
  await narrationBeat(
    service, env, sessionId,
    `${ctx.narrationContext ? `${ctx.narrationContext} ` : ''}${bridge ? `${bridge} ` : ''}` +
      `${climaxFraming}Open this scene: ${node.narrationSeed} ` +
      standing +
      // The scene-opening cutscene lands with the previous narration still in the context window,
      // and once reproduced it verbatim - closing menu included - so the node's authored seed never
      // reached the page at all (live 2026-07-27).
      //
      // TOO ABSOLUTE, THOUGH (2026-07-29). "Never restate or paraphrase the previous narration"
      // reads as "ignore what just happened", and with no bridge line to hold onto (see
      // bridgeFromLastResolution) the narrator did the only thing left: it started over. Live run
      // 79cd4ae2, the climax - narration #33 had Saltmarsh Veil RISE out of the harbour; the
      // director dropped to rung 4, opened the rescue, and #35 wrote "Kestrel wakes on the
      // splintered planks of Pier Nine... Saltmarsh Veil is gone - not risen, not saved". Two
      // consecutive wake-ups and the Tide-Ledger changed hands with no event between.
      //
      // The rule that was wanted is "do not REPRODUCE it", not "do not CONTINUE from it".
      'This OPENS A NEW SCENE: do not restate or reproduce the previous narration - but do continue ' +
      'from it. The party is exactly where that scene left them, holding what it left them holding.' +
      (node.spec
        ? ` Telegraph what lies ahead - "${String(node.spec.label ?? node.label)}"` +
          `${stakes ? ` (at stake: ${stakes})` : ''} - and make the closing ask invite the party into it.`
        : '') +
      waysLine,
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
