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

  const atoms = atomsToSatisfy(objective.completion_predicates)
  const dm = (body) => act(token, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', ...body })

  for (const flag of atoms.flags) await dm({ command: 'set_flag', flag, force: true })
  for (const fact of atoms.facts) await dm({ command: 'set_fact', fact: fact.name, value: fact.value })
  for (const tag of atoms.events) await dm({ command: 'mark_event', tag, force: true })

  log('autocomplete', 'objective.driven', objective.title, {
    objective_id: objectiveId,
    wrote: { flags: atoms.flags, events: atoms.events, facts: atoms.facts.map((f) => f.name) },
  })
  return { done: true, objectiveId, title: objective.title }
}
