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
import type { StoryGraph } from '../_shared/guide/graph.ts'
import type { StageEnv } from './stage-env.ts'
import { assertOk, logPipelineEvent, syncSpineAtoms } from './util.ts'

export async function runStage8(env: StageEnv): Promise<void> {
  if (!env.adventure.meta_loop) throw new Error('meta_loop missing - stage 1 must run first')

  // Final authoritative registry pass: stage 7's repair loop may have rewritten predicates
  // since stage 3 emitted the spine atoms (overhaul Phase 1).
  await syncSpineAtoms(env.db, env.adventure.id)

  const [chapters, objectives, npcs] = await Promise.all([
    env.db.from('chapters').select('id, index, title, arc_summary').eq('adventure_id', env.adventure.id).order('index'),
    env.db
      .from('objectives')
      .select('id, chapter_id, index, title, hidden_description')
      .eq('adventure_id', env.adventure.id),
    env.db.from('npcs').select('id, name, role').eq('adventure_id', env.adventure.id).order('created_at'),
  ])
  for (const res of [chapters, objectives, npcs]) assertOk(res.error, 'stage-8 load failed')

  const chapterNumber = new Map((chapters.data ?? []).map((c) => [c.id, c.index + 1]))
  // The prompt lists objectives/NPCs in THIS order; signal refs are 1-based into these arrays.
  const sortedObjectives = (objectives.data ?? []).sort(
    (a, b) => (chapterNumber.get(a.chapter_id) ?? 0) - (chapterNumber.get(b.chapter_id) ?? 0) || a.index - b.index,
  )
  const sortedNpcs = npcs.data ?? []

  const ctx: Stage8Context = {
    metaLoop: env.adventure.meta_loop,
    chapters: (chapters.data ?? []).map((c) => ({ title: c.title, arcSummary: c.arc_summary })),
    objectives: sortedObjectives.map((o) => ({
      chapterNumber: chapterNumber.get(o.chapter_id) ?? 0,
      title: o.title,
      hiddenDescription: o.hidden_description,
    })),
    npcs: sortedNpcs.map((n) => ({ name: n.name, role: n.role as 'npc' | 'boss' })),
  }

  const output = await env.generate('story_director', buildStage8Prompt(ctx), (raw) =>
    parseStage8(raw, sortedObjectives.length, sortedNpcs.length),
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
  const [chapters, objectives, npcs, encounters, ingredients, endings] = await Promise.all([
    env.db.from('chapters').select('id, index, title').eq('adventure_id', adventureId).order('index'),
    env.db.from('objectives').select('id, chapter_id, index, title, completion_predicates, guaranteed_route').eq('adventure_id', adventureId),
    env.db.from('npcs').select('id, name, chapter_id, initial_state').eq('adventure_id', adventureId),
    env.db.from('encounters').select('id, chapter_id, type, outcome_atoms').eq('adventure_id', adventureId),
    env.db.from('ingredients').select('id, chapter_id, awards_atoms').eq('adventure_id', adventureId),
    env.db.from('endings').select('id, title, trigger_conditions').eq('adventure_id', adventureId),
  ])

  const atomsOf = (raw: unknown): string[] =>
    Array.isArray(raw) ? raw.filter((a): a is string => typeof a === 'string') : []
  const routeAtoms = (raw: unknown): string[] => {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return []
    return atomsOf((raw as Record<string, unknown>).onSuccess)
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
  if (REACHABILITY_GATE === 'fail' && hasBlockingErrors(findings)) {
    throw new Error(
      `reachability gate: ${findings.filter((f) => f.severity === 'error').map((f) => f.message).join(' | ')}`,
    )
  }
}
