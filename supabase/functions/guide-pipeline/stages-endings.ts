// Stage 8 - Ending Designer, whole guide (F04 SS4.2): authors the 3-5 hidden candidate endings
// (direction, not script) + the adventure's 2-4 story dials. Signals use a closed vocabulary
// (objective outcomes, NPC states, dial thresholds); the LLM references objectives/NPCs by list
// number and we map them to row UUIDs here. Writes distinctness warnings and - as the final
// stage - flips the adventure to guide_ready.
import {
  buildStage8Prompt,
  parseStage8,
  signalWhenToStored,
  validateEndingDistinctness,
  validateEndingReachability,
  type Stage8Context,
} from '../_shared/guide/stages/stage8.ts'
import { hasBlockingErrors, lintStoryGraph } from '../_shared/guide/graph.ts'
import { deriveLoreReveals } from '../_shared/guide/lore-reveals.ts'
import { deriveNpcItineraries } from '../_shared/guide/npc-itinerary.ts'
import { proveGraph } from '../_shared/guide/prove.ts'
import type { StoryGraph } from '../_shared/guide/graph.ts'
import type { StageEnv } from './stage-env.ts'
import { assertOk, logPipelineEvent, syncSpineAtoms } from './util.ts'

export async function runStage8(env: StageEnv): Promise<void> {
  if (!env.adventure.meta_loop) throw new Error('meta_loop missing - stage 1 must run first')

  // Final authoritative registry pass over the spine atoms stage 3 emitted (overhaul Phase 1).
  await syncSpineAtoms(env.db, env.adventure.id)

  const [chapters, objectives, npcs] = await Promise.all([
    env.db.from('chapters').select('id, index, title, arc_summary').eq('adventure_id', env.adventure.id).order('index'),
    env.db
      .from('objectives')
      .select('id, chapter_id, index, title, hidden_description')
      .eq('adventure_id', env.adventure.id),
    env.db.from('npcs').select('id, name, role, initial_state').eq('adventure_id', env.adventure.id).order('created_at'),
  ])
  for (const res of [chapters, objectives, npcs]) assertOk(res.error, 'stage-8 load failed')

  const chapterNumber = new Map((chapters.data ?? []).map((c) => [c.id, c.index + 1]))
  // The prompt lists objectives/NPCs in THIS order; signal refs are 1-based into these arrays.
  const sortedObjectives = (objectives.data ?? []).sort(
    (a, b) => (chapterNumber.get(a.chapter_id) ?? 0) - (chapterNumber.get(b.chapter_id) ?? 0) || a.index - b.index,
  )
  const sortedNpcs = npcs.data ?? []

  // WHEN MAY THE NARRATOR EXPLAIN A FORCE (2026-07-28). Derived here because this is the first
  // whole-guide stage that can see every objective at once, and stored so it can be inspected and
  // corrected before play rather than recomputed mid-story. A force no objective names resolves
  // nowhere and stays withheld - the pre-gate behaviour - so this can only loosen, never leak.
  const loreNames = ((env.adventure.meta_loop.entities ?? []) as { kind: string; name: string }[])
    .filter((e) => e.kind === 'lore')
    .map((e) => e.name)
  const revealsByObjective = deriveLoreReveals(
    loreNames,
    sortedObjectives.map((o) => ({
      id: o.id as string, index: o.index as number,
      title: (o.title as string) ?? '', hiddenDescription: (o.hidden_description as string) ?? '',
    })),
  )
  for (const [objectiveId, names] of revealsByObjective) {
    const { error } = await env.db.from('objectives').update({ reveals_lore: names }).eq('id', objectiveId)
    assertOk(error, 'lore reveal write failed')
  }
  // WHERE EVERYONE IS, AND WHEN (2026-07-28). Derived here for the same reason the lore gate is:
  // this is the first whole-guide stage that can see every objective and every node at once, and a
  // stored answer can be inspected before play rather than recomputed mid-story.
  const objectiveIndexById = new Map(sortedObjectives.map((o, i) => [o.id as string, i]))
  const { data: nodeRows } = await env.db
    .from('story_nodes')
    .select('objective_id, location_id, encounter_spec')
    .eq('adventure_id', env.adventure.id)
  const itineraries = deriveNpcItineraries(
    ((nodeRows ?? []) as { objective_id: string; location_id: string | null; encounter_spec: Record<string, unknown> | null }[])
      .map((n) => ({
        objectiveId: n.objective_id,
        locationId: n.location_id,
        // npc_ids live inside encounter_spec.params - see stages-content.ts storedSpec.
        npcIds: (((n.encounter_spec?.params as Record<string, unknown> | undefined)?.npc_ids ?? []) as unknown[])
          .filter((v): v is string => typeof v === 'string'),
      })),
    objectiveIndexById,
  )
  for (const [npcId, stops] of itineraries) {
    const { error } = await env.db.from('npcs').update({ itinerary: stops }).eq('id', npcId)
    assertOk(error, 'npc itinerary write failed')
  }
  await logPipelineEvent(env.db, env.adventure.id, 'npc_itineraries_derived', {
    placed: itineraries.size,
    travelling: [...itineraries.values()].filter((s) => s.length > 1).length,
  })

  await logPipelineEvent(env.db, env.adventure.id, 'lore_reveals_derived', {
    lore: loreNames.length,
    resolved: [...revealsByObjective.values()].flat().length,
    unresolved: loreNames.filter((n) => ![...revealsByObjective.values()].flat().includes(n)),
  })

  const ctx: Stage8Context = {
    metaLoop: env.adventure.meta_loop,
    chapters: (chapters.data ?? []).map((c) => ({ title: c.title, arcSummary: c.arc_summary })),
    objectives: sortedObjectives.map((o) => ({
      chapterNumber: chapterNumber.get(o.chapter_id) ?? 0,
      title: o.title,
      hiddenDescription: o.hidden_description,
    })),
    npcs: sortedNpcs.map((n) => ({
      name: n.name, role: n.role as 'npc' | 'boss', initialState: n.initial_state as string | null,
    })),
  }

  // Who cannot carry a rapport signal: disposition only ever moves for someone the party can
  // actually meet. 1-based, matching the numbering the prompt hands the model.
  const noRapport = new Set(
    sortedNpcs.map((n, i) => (n.initial_state === 'absent' ? i + 1 : 0)).filter((i) => i > 0),
  )
  const output = await env.generate('story_director', buildStage8Prompt(ctx), (raw) =>
    parseStage8(raw, sortedObjectives.length, sortedNpcs.length, noRapport),
  )

  const objectiveIds = sortedObjectives.map((o) => o.id as string)
  const npcIds = sortedNpcs.map((n) => n.id as string)

  // Store dials on the adventure (declared axes only; live values are F08 state).
  const { error: dialError } = await env.db
    .from('adventures')
    .update({ story_dials: output.dials })
    .eq('id', env.adventure.id)
  assertOk(dialError, 'story_dials write failed')

  // Replace previously generated (untouched) endings; human-edited ones stay (F04 SS7).
  const { error: deleteError } = await env.db
    .from('endings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('human_edited', false)
  assertOk(deleteError, 'endings delete failed')

  const { error: insertError } = await env.db.from('endings').insert(
    output.endings.map((e, i) => ({
      adventure_id: env.adventure.id,
      index: i,
      title: e.title,
      description: e.description,
      climax_summary: e.climaxSummary,
      tone: e.tone,
      trigger_conditions: {
        summary: e.triggerConditions.summary,
        signals: e.triggerConditions.signals.map((s) => ({
          when: signalWhenToStored(s.when, objectiveIds, npcIds),
          weight: s.weight,
          note: s.note,
        })),
      },
      exclusivity_group: e.exclusivityGroup,
    })),
  )
  assertOk(insertError, 'endings insert failed')

  const { error: warnClearError } = await env.db
    .from('guide_warnings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('stage', 8)
  assertOk(warnClearError, 'stage-8 warning cleanup failed')

  const warnings = [
    ...validateEndingDistinctness(output.endings),
    ...validateEndingReachability(output.endings, sortedObjectives.length),
  ]
  if (warnings.length > 0) {
    const { error } = await env.db.from('guide_warnings').insert(
      warnings.map((message) => ({
        adventure_id: env.adventure.id,
        stage: 8,
        target_table: 'endings',
        target_id: null,
        message,
      })),
    )
    assertOk(error, 'stage-8 warnings insert failed')
  }

  // Reachability gate (Phase 5): the LAST thing before the guide ships. Stage 7 checks prose
  // contradictions; this checks whether the adventure can actually be FINISHED - the class of
  // failure that shipped a permanently unwinnable guide (docs/F08 §12).
  await runReachabilityGate(env)

  const { error: statusError } = await env.db
    .from('adventures')
    .update({ status: 'guide_ready', updated_at: new Date().toISOString() })
    .eq('id', env.adventure.id)
  assertOk(statusError, 'status update failed')
}

/**
 * Rollout switch. 'warn' records findings and ships anyway; 'fail' refuses to flip
 * `guide_ready`, which routes the stage into the existing retry/repair machinery.
 *
 * Tightened to 'fail' on 2026-07-23 after three paid runs. The case for it: run 54410de6
 * shipped "Reach Oakhaven" with `objective_unreachable`, and that was precisely the objective
 * still unfinished when the run ended - the lint called the failure before a single turn was
 * played, and 'warn' let it ship anyway. The two causes behind that finding are now fixed
 * (negative predicate clauses; award atoms re-derived after stage-7 repairs), and the run after
 * them produced zero error-severity findings. Revert to 'warn' if a false hard error ever
 * blocks generation - an unshippable guide is worse than an imperfect one.
 */
export const REACHABILITY_GATE: 'off' | 'warn' | 'fail' = 'fail'

async function runReachabilityGate(env: StageEnv): Promise<void> {
  if (REACHABILITY_GATE === 'off') return
  const adventureId = env.adventure.id
  const [chapters, objectives, npcs, encounters, ingredients, endings, nodes, atoms, slots] = await Promise.all([
    env.db.from('chapters').select('id, index, title').eq('adventure_id', adventureId).order('index'),
    env.db.from('objectives').select('id, chapter_id, index, title, completion_predicates, guaranteed_route').eq('adventure_id', adventureId),
    env.db.from('npcs').select('id, name, chapter_id, initial_state').eq('adventure_id', adventureId),
    env.db.from('encounters').select('id, chapter_id, type, outcome_atoms').eq('adventure_id', adventureId),
    env.db.from('ingredients').select('id, chapter_id, awards_atoms').eq('adventure_id', adventureId),
    env.db.from('endings').select('id, title, trigger_conditions').eq('adventure_id', adventureId),
    env.db.from('story_nodes').select('id, key, objective_id, kind, role, encounter_spec, transitions, establishes').eq('adventure_id', adventureId),
    env.db.from('story_atoms').select('slug, scope').eq('adventure_id', adventureId),
    env.db.from('personal_slots').select('id, key, overlay_attachments').eq('adventure_id', adventureId),
  ])

  const atomsOf = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : []
  const routeAtoms = (raw: unknown): string[] => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    return atomsOf((raw as Record<string, unknown>).onSuccess)
  }
  const specField = (spec: unknown, key: string): string[] => {
    if (typeof spec !== 'object' || spec === null) return []
    return atomsOf((spec as Record<string, unknown>)[key])
  }

  const graph: StoryGraph = {
    chapters: ((chapters.data ?? []) as { id: string; index: number; title: string | null }[])
      .map((c) => ({ id: c.id, index: c.index, title: c.title ?? '' })),
    objectives: ((objectives.data ?? []) as {
      id: string; chapter_id: string; index: number; title: string
      completion_predicates: unknown; guaranteed_route: unknown
    }[]).map((o) => ({
      id: o.id, chapterId: o.chapter_id, index: o.index, title: o.title,
      completionPredicates: o.completion_predicates,
      guaranteedRouteAtoms: routeAtoms(o.guaranteed_route),
    })),
    npcs: ((npcs.data ?? []) as { id: string; name: string; chapter_id: string | null; initial_state: string | null }[])
      .map((n) => ({ id: n.id, name: n.name, chapterId: n.chapter_id, initialState: n.initial_state ?? 'alive' })),
    encounters: ((encounters.data ?? []) as { id: string; chapter_id: string | null; type: string; outcome_atoms: unknown }[])
      .map((e) => ({ id: e.id, chapterId: e.chapter_id, type: e.type, outcomeAtoms: atomsOf(e.outcome_atoms) })),
    ingredients: ((ingredients.data ?? []) as { id: string; chapter_id: string | null; awards_atoms: unknown }[])
      .map((i) => ({ id: i.id, chapterId: i.chapter_id, awardsAtoms: atomsOf(i.awards_atoms) })),
    endings: ((endings.data ?? []) as { id: string; title: string; trigger_conditions: unknown }[]).map((e) => {
      const conditions = (typeof e.trigger_conditions === 'object' && e.trigger_conditions !== null
        ? e.trigger_conditions
        : {}) as Record<string, unknown>
      const signals = Array.isArray(conditions.signals) ? conditions.signals : []
      return {
        id: e.id,
        title: e.title,
        objectiveSignals: signals.flatMap((s) => {
          if (typeof s !== 'object' || s === null) return []
          const signal = s as Record<string, unknown>
          const when = (typeof signal.when === 'object' && signal.when !== null ? signal.when : {}) as Record<string, unknown>
          if (typeof when.objective_id !== 'string') return []
          const outcome = when.outcome === 'failed' ? 'failed' as const : 'completed' as const
          return [{ objectiveId: when.objective_id, outcome, weight: Number(signal.weight) || 0 }]
        }),
        npcSignals: signals.flatMap((s) => {
          if (typeof s !== 'object' || s === null) return []
          const signal = s as Record<string, unknown>
          const when = (typeof signal.when === 'object' && signal.when !== null ? signal.when : {}) as Record<string, unknown>
          if (typeof when.npc_id !== 'string' || typeof when.state !== 'string') return []
          return [{ npcId: when.npc_id, state: when.state, weight: Number(signal.weight) || 0 }]
        }),
      }
    }),
    nodes: ((nodes.data ?? []) as {
      id: string; key: string; objective_id: string; kind: string; role: string
      encounter_spec: unknown; transitions: unknown; establishes: unknown
    }[]).map((n) => {
      const spec = (typeof n.encounter_spec === 'object' && n.encounter_spec !== null ? n.encounter_spec : {}) as Record<string, unknown>
      const params = (typeof spec.params === 'object' && spec.params !== null ? spec.params : {}) as Record<string, unknown>
      return {
        id: n.id, key: n.key, objectiveId: n.objective_id,
        kind: n.kind as 'skill_challenge' | 'social' | 'puzzle' | 'combat',
        role: n.role === 'rescue' ? 'rescue' as const : 'route' as const,
        onSuccess: specField(spec, 'on_success'),
        onPartial: specField(spec, 'on_partial'),
        onFailure: specField(spec, 'on_failure'),
        // Empty on guides authored before 2026-07-29, which still carry the plot atom in
        // on_success - the registry walk reads both.
        establishes: atomsOf(n.establishes),
        npcIds: atomsOf(params.npc_ids),
        transitions: (Array.isArray(n.transitions) ? n.transitions : []).flatMap((t) => {
          if (typeof t !== 'object' || t === null) return []
          const tr = t as Record<string, unknown>
          return [{
            on: (tr.on === 'partial' ? 'partial' : tr.on === 'failed' ? 'failed' : 'full') as 'full' | 'partial' | 'failed',
            toNodeKey: typeof tr.to_node_key === 'string' ? tr.to_node_key : null,
            arrivalContext: typeof tr.arrival_context === 'string' ? tr.arrival_context : '',
          }]
        }),
        minParticipants: typeof params.min_participants === 'number' ? params.min_participants : undefined,
      }
    }),
    registryAtoms: ((atoms.data ?? []) as { slug: string }[]).map((a) => a.slug),
    minPlayers: env.adventure.min_players,
    maxPlayers: env.adventure.max_players,
    personalAtoms: ((atoms.data ?? []) as { slug: string; scope: string }[])
      .filter((a) => a.scope === 'personal').map((a) => a.slug),
    personalSlots: ((slots.data ?? []) as { id: string; key: string; overlay_attachments: unknown }[])
      .map((s) => ({
        id: s.id, key: s.key,
        overlayNodeKeys: (Array.isArray(s.overlay_attachments) ? s.overlay_attachments : []).flatMap((o) => {
          if (typeof o !== 'object' || o === null) return []
          const ov = o as Record<string, unknown>
          return typeof ov.node_key === 'string' ? [ov.node_key] : []
        }),
      })),
  }

  const findings = lintStoryGraph(graph)
  if (findings.length > 0) {
    await env.db.from('guide_warnings').insert(
      findings.map((f) => ({
        adventure_id: adventureId,
        stage: 8,
        target_table: f.target?.table ?? 'adventures',
        target_id: f.target?.id ?? null,
        kind: f.severity === 'error' ? 'warning' : 'info',
        message: `[reachability:${f.code}] ${f.message}`,
      })),
    )
    await logPipelineEvent(env.db, adventureId, 'reachability_lint', {
      gate: REACHABILITY_GATE,
      errors: findings.filter((f) => f.severity === 'error').length,
      warnings: findings.filter((f) => f.severity === 'warning').length,
      codes: findings.map((f) => f.code),
    })
  }
  // The playability proof. The lint above checks SHAPES someone thought to write a rule about;
  // this walks every path through the authored graph and asks whether it behaves: is the
  // objective winnable at all, and does every path terminate?
  //
  // It earned its place on the first real guide it saw, catching an objective whose second route
  // and rescue were unreachable because losing the FIRST node won the objective. The specific
  // defect it found is now unauthorable (completion is structural, not derived from atoms), but
  // the walk stays - the whole point of a prover over a linter is catching the shape nobody
  // predicted, and the next one will not look like the last.
  const proofFindings = proveGraph({
    objectives: graph.objectives.map((o) => ({ id: o.id, title: o.title })),
    nodes: (graph.nodes ?? []).map((n) => ({
      id: n.id, key: n.key, objectiveId: n.objectiveId, index: n.index, role: n.role,
      transitions: n.transitions,
    })),
  })
  if (proofFindings.length > 0) {
    await env.db.from('guide_warnings').insert(
      proofFindings.map((f) => ({
        adventure_id: adventureId,
        stage: 8,
        target_table: 'objectives',
        target_id: f.objectiveId,
        kind: 'warning',
        message: `[playability:${f.code}] ${f.message}${f.path?.length ? ` (path: ${f.path.join(' -> ')})` : ''}`,
      })),
    )
    await logPipelineEvent(env.db, adventureId, 'playability_proof', {
      findings: proofFindings.length,
      codes: proofFindings.map((f) => f.code),
    })
  }

  const blocking = proofFindings.filter((f) => f.code !== 'node_unreachable')
  if (REACHABILITY_GATE === 'fail' && (hasBlockingErrors(findings) || blocking.length > 0)) {
    const reasons = [
      ...findings.filter((f) => f.severity === 'error').map((f) => f.message),
      ...blocking.map((f) => f.message),
    ]
    throw new Error(`reachability gate: ${reasons.join(' | ')}`)
  }
}
