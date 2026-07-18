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
  type Stage8Context,
} from '../_shared/guide/stages/stage8.ts'
import type { StageEnv } from './stage-env.ts'
import { assertOk } from './util.ts'

export async function runStage8(env: StageEnv): Promise<void> {
  if (!env.adventure.meta_loop) throw new Error('meta_loop missing - stage 1 must run first')

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

  const warnings = validateEndingDistinctness(output.endings)
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

  const { error: statusError } = await env.db
    .from('adventures')
    .update({ status: 'guide_ready', updated_at: new Date().toISOString() })
    .eq('id', env.adventure.id)
  assertOk(statusError, 'status update failed')
}
