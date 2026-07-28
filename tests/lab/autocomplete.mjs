// Lab-only: drive objectives to completion so a run reaches its ENDING quickly, without
// touching production code. The genre sweep showed the engine completes 1-3 objectives per 50
// turns while adventures author 3-4, so no run ever reached commitment - and the ending
// machinery (scoring, the leading/committed transition, the forced commit when all objectives
// are terminal) had almost never been exercised live.
//
// This does NOT fake the ending. It injects exactly the atoms each objective's predicate needs
// through the same DM overrides a human DM has - set_flag / mark_event / set_fact - and the
// real deterministic progress pass then completes the objective, advances the ladder, re-scores
// endings, and commits one when they all go terminal. We are exercising the genuine path from
// atoms -> objective -> ending, just at a tempo the pacing can't yet reach on its own.

/**
 * The atoms to WRITE to satisfy a predicate, split by the override that writes each. Mirrors
 * packages/rules minimalSatisfyingAtoms, reimplemented here so the node runner needs no TS
 * loader: `eq: true` costs the atom, `eq: false` is satisfied by ABSENCE and costs nothing
 * (writing it true would BREAK a "has not happened yet" clause), events are always claimable.
 */
export function atomsToSatisfy(predicate) {
  const out = { flags: [], events: [], facts: [] }
  const walk = (p) => {
    if (!p || typeof p !== 'object') return
    if (Array.isArray(p.all)) { p.all.forEach(walk); return }
    if (Array.isArray(p.any)) {
      // Cheapest branch: prefer one that costs zero writes, else the first.
      const scored = p.any.map((b) => ({ b, cost: branchCost(b) }))
      scored.sort((a, z) => a.cost - z.cost)
      if (scored[0]) walk(scored[0].b)
      return
    }
    if (typeof p.flag === 'string') { if (p.eq !== false) out.flags.push(p.flag); return }
    if (typeof p.fact === 'string') { if (p.eq !== false) out.facts.push({ name: p.fact, value: p.eq ?? true }); return }
    if (typeof p.event === 'string') out.events.push(p.event)
  }
  walk(predicate)
  return out
}

function branchCost(p) {
  if (!p || typeof p !== 'object') return 99
  if (Array.isArray(p.all)) return p.all.reduce((s, b) => s + branchCost(b), 0)
  if (Array.isArray(p.any)) return Math.min(...p.any.map(branchCost))
  if (typeof p.flag === 'string') return p.eq === false ? 0 : 1
  if (typeof p.fact === 'string') return p.eq === false ? 0 : 1
  if (typeof p.event === 'string') return 1
  return 99
}

/**
 * Complete the active objective by writing its atoms via DM overrides. Returns what it did.
 * `force` is used because a lab driver legitimately knows the authored atom names and should not
 * be turned away by the resolver's suggestion path - it is the "human DM escape hatch" the
 * override was built with, and every forced write logs `atom_forced` for the audit.
 */
export async function completeActiveObjective({ act, serviceRest, token, advId, log }) {
  const state = (await act(token, { action: 'resync', adventure_id: advId })).body.state
  const objectiveId = state?.objectives?.currentId
  if (!objectiveId) return { done: false, reason: 'no active objective' }

  // NEVER drive mid-scene (2026-07-28). `objectiveOutcome` refuses to resolve an objective while an
  // encounter is open - a deliberate guard, because `used` is written when a beat is INSERTED, so
  // asking the navigator mid-scene reports the ladder exhausted and retires the objective out from
  // under the party. Injecting an `encounter_resolved` row does not close the encounter FRAME
  // (only resolveOpenEncounter does that, through the real path), so a drive attempted here is a
  // silent no-op: the row lands, the progress pass runs, and nothing completes. Wait for the gap
  // between scenes - the player agent resolves encounters on its own, and this is called every
  // couple of turns, so a window comes round quickly.
  if (state?.encounter) {
    log('autocomplete', 'objective.deferred', 'an encounter is open - waiting for the scene to close', {
      objective_id: objectiveId, encounter: state.encounter.label ?? null,
    })
    return { done: false, reason: 'encounter open' }
  }

  // Drive the story UP TO the finale, then get out of the way. Injecting the final objective's
  // atoms directly would complete it without the climax beat ever opening - which is exactly how
  // the plain autocomplete skipped the climax. Leaving the last objective for natural play lets
  // the forced re-plan open the climax beat (a boss combat auto-opens; a social finale is
  // played), so we can watch the whole rising-action -> climax -> conclusion arc cheaply.
  const objs = await serviceRest('GET', `objectives?adventure_id=eq.${advId}&select=reveal_state`)
  const remaining = objs.filter((o) => o.reveal_state === 'hidden' || o.reveal_state === 'active')
  if (remaining.length <= 1) {
    log('autocomplete', 'climax.reached', 'final objective active - letting the climax play out', {
      objective_id: objectiveId,
    })
    return { done: false, climax: true }
  }

  const [objective] = await serviceRest(
    'GET', `objectives?id=eq.${objectiveId}&select=title,completion_predicates`)
  if (!objective) return { done: false, reason: 'objective row missing' }

  const dm = (body) => act(token, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', ...body })

  // GRAPH-BEARING GUIDES: RESOLVE A SCENE, DO NOT WRITE ATOMS (2026-07-28).
  //
  // Everything below this block writes the objective's completion_predicates through DM overrides,
  // which is how objectives used to complete. Since 2026-07-27 `objectiveOutcome` does not read the
  // predicate at all when the objective has authored nodes - "an objective resolves because a scene
  // resolved, never because a bag of flags added up" - so on every guide authored since, this
  // driver has been INERT. Live 2026-07-28 it logged `objective.driven` five times against the same
  // objective and completed none of them; the run could never reach an ending, which is why the
  // ending machinery it exists to exercise still had not been exercised.
  //
  // The graph's own resolution path is an `encounter_resolved` naming the node and its tier - the
  // same event a won scene emits, and what `lastResolvedNode` reads. Award the node's authored
  // on_success atoms alongside it so the world state matches the win, exactly as an outcome map
  // would. This is still not faking the ending: the navigator, the ladder, ending scoring and the
  // commitment gate all run for real.
  const nodes = await serviceRest(
    'GET', `story_nodes?objective_id=eq.${objectiveId}&select=id,key,role,encounter_spec&order=index`)
  if (nodes.length > 0) {
    const resolved = await serviceRest(
      'GET', `event_log?adventure_id=eq.${advId}&type=eq.encounter_resolved&select=payload`)
    const done = new Set(resolved.map((e) => e?.payload?.node_key).filter(Boolean))
    // Resolve the scene the party is actually IN - the active beat's node - not an arbitrary
    // unplayed one. `objectiveOutcome` refuses to retire an objective while a beat is active and
    // unresolved (inPlayNodeKey), so resolving some OTHER node leaves the objective open and the
    // drive is a silent no-op. Live 2026-07-28: the rescue node sorts first (buildRescueNode uses
    // index 0), so the driver kept winning r0 while the party stood in n0, and nothing completed.
    const loops = await serviceRest('GET', `core_loops?adventure_id=eq.${advId}&select=current_beat_id,status`)
    const activeLoop = loops.find((l) => l.status === 'active')
    let inPlay = null
    if (activeLoop?.current_beat_id) {
      const [beat] = await serviceRest('GET', `beats?id=eq.${activeLoop.current_beat_id}&select=node_id,status`)
      if (beat?.status === 'active' && beat.node_id) inPlay = nodes.find((n) => n.id === beat.node_id) ?? null
    }
    // Otherwise the first unplayed ROUTE - never the rescue, which is the ladder's terminal.
    const target = inPlay
      ?? nodes.find((n) => n.role === 'route' && !done.has(n.key))
      ?? nodes.find((n) => !done.has(n.key))
      ?? nodes[0]
    const onSuccess = Array.isArray(target.encounter_spec?.on_success) ? target.encounter_spec.on_success : []
    await serviceRest('POST', 'event_log', {
      adventure_id: advId, session_id: state?.session?.id ?? null, type: 'encounter_resolved',
      payload: { node_key: target.key, tier: 'full', milestones: onSuccess, lab_driven: true },
    })
    // Any DM override runs the deterministic progress pass, which is what reads the graph.
    await dm({ command: 'set_fact', fact: `lab_drove_${objectiveId.slice(0, 8)}`, value: true })
    log('autocomplete', 'objective.driven', objective.title, {
      objective_id: objectiveId, via: 'graph', node_key: target.key, milestones: onSuccess,
      picked: inPlay ? 'active beat' : 'first unplayed route',
    })
    return { done: true, objectiveId, title: objective.title }
  }

  // LEGACY GUIDES (no authored nodes) still complete by predicate - unchanged.
  const atoms = atomsToSatisfy(objective.completion_predicates)

  for (const flag of atoms.flags) await dm({ command: 'set_flag', flag, force: true })
  for (const fact of atoms.facts) await dm({ command: 'set_fact', fact: fact.name, value: fact.value })
  for (const tag of atoms.events) await dm({ command: 'mark_event', tag, force: true })

  log('autocomplete', 'objective.driven', objective.title, {
    objective_id: objectiveId, via: 'predicate',
    wrote: { flags: atoms.flags, events: atoms.events, facts: atoms.facts.map((f) => f.name) },
  })
  return { done: true, objectiveId, title: objective.title }
}
