// Stages 1-3: Story Director work. Chapter arcs -> scene scaffolding -> objectives.
import {
  buildStage1Prompt,
  parseStage1,
} from '../_shared/guide/stages/stage1.ts'
import { buildStage2Prompt, parseStage2 } from '../_shared/guide/stages/stage2.ts'
import { buildStage3Prompt, parseStage3 } from '../_shared/guide/stages/stage3.ts'
import { buildGuaranteedRoute } from '../_shared/guide/guaranteed-route.ts'
import type { ChapterSketch, Json, MetaLoop } from '../_shared/guide/types.ts'
import { enqueueJob, type StageEnv } from './stage-env.ts'
import { assertOk, syncSpineAtoms, toSeed } from './util.ts'

interface ChapterRow {
  id: string
  index: number
  title: string
  arc_summary: string
}

async function loadChapters(env: StageEnv): Promise<ChapterRow[]> {
  const { data, error } = await env.db
    .from('chapters')
    .select('id, index, title, arc_summary')
    .eq('adventure_id', env.adventure.id)
    .order('index')
  assertOk(error, 'chapters load failed')
  return data ?? []
}

function metaLoopOf(env: StageEnv): MetaLoop {
  if (!env.adventure.meta_loop) throw new Error('meta_loop missing - stage 1 must run first')
  return env.adventure.meta_loop
}

export function chapterSketch(row: ChapterRow): ChapterSketch {
  return { title: row.title, arcSummary: row.arc_summary }
}

export async function loadChapterScenes(env: StageEnv, chapterId: string): Promise<{ sketch: string }[]> {
  const { data, error } = await env.db
    .from('scenes')
    .select('sketch')
    .eq('chapter_id', chapterId)
    .order('index')
  assertOk(error, 'scenes load failed')
  return data ?? []
}

export async function runStage1(env: StageEnv): Promise<void> {
  const seed = toSeed(env.adventure)
  const output = await env.generate('story_director', buildStage1Prompt(seed), (raw) => parseStage1(raw, seed))

  const { error: metaError } = await env.db
    .from('adventures')
    .update({ meta_loop: output.metaLoop, updated_at: new Date().toISOString() })
    .eq('id', env.adventure.id)
  assertOk(metaError, 'meta_loop write failed')
  env.adventure.meta_loop = output.metaLoop

  const { data: inserted, error: insertError } = await env.db
    .from('chapters')
    .insert(
      output.chapters.map((ch, i) => ({
        adventure_id: env.adventure.id,
        index: i,
        title: ch.title,
        arc_summary: ch.arcSummary,
      })),
    )
    .select('id, index')
  assertOk(insertError, 'chapters insert failed')

  for (const row of (inserted ?? []).sort((a, b) => a.index - b.index)) {
    await enqueueJob(env.db, env.adventure.id, 2, row.id)
  }
}

export async function runStage2(env: StageEnv, chapterId: string): Promise<void> {
  const chapters = await loadChapters(env)
  const chapterIndex = chapters.findIndex((c) => c.id === chapterId)
  if (chapterIndex === -1) throw new Error('chapter not found')

  const output = await env.generate(
    'story_director',
    buildStage2Prompt({ metaLoop: metaLoopOf(env), chapters: chapters.map(chapterSketch), chapterIndex }),
    parseStage2,
  )

  const { error: deleteError } = await env.db.from('scenes').delete().eq('chapter_id', chapterId)
  assertOk(deleteError, 'scenes delete failed')
  const { error: insertError } = await env.db.from('scenes').insert(
    output.scenes.map((s, i) => ({
      adventure_id: env.adventure.id,
      chapter_id: chapterId,
      index: i,
      sketch: s.sketch,
    })),
  )
  assertOk(insertError, 'scenes insert failed')

  // The chapter's entity list is stage 4's must-cover contract (F04 SS2.1).
  const { error: entityError } = await env.db
    .from('chapters')
    .update({ entities: output.entities })
    .eq('id', chapterId)
  assertOk(entityError, 'chapter entities write failed')

  await enqueueJob(env.db, env.adventure.id, 3, chapterId)
}

export async function runStage3(env: StageEnv, chapterId: string): Promise<void> {
  const chapters = await loadChapters(env)
  const chapter = chapters.find((c) => c.id === chapterId)
  if (!chapter) throw new Error('chapter not found')
  const scenes = await loadChapterScenes(env, chapterId)
  // Stage 3 runs once per chapter, so only the caller can stop chapter N re-authoring what
  // chapter N-1 already covers.
  const { data: priorRows } = await env.db
    .from('objectives')
    .select('title, chapter_id')
    .eq('adventure_id', env.adventure.id)
    .neq('chapter_id', chapterId)
  const priorObjectiveTitles = ((priorRows ?? []) as { title: string }[]).map((o) => o.title).filter(Boolean)

  const objectives = await env.generate(
    'story_director',
    buildStage3Prompt({
      metaLoop: metaLoopOf(env),
      chapter: chapterSketch(chapter),
      chapterNumber: chapter.index + 1,
      scenes,
      adventureType: env.adventure.type ?? undefined,
      priorObjectiveTitles,
      chapterCount: chapters.length,
    }),
    parseStage3,
  )

  // Regeneration keeps human-edited rows untouched (F04 SS7); only generated rows are replaced.
  const { error: deleteError } = await env.db
    .from('objectives')
    .delete()
    .eq('chapter_id', chapterId)
    .eq('human_edited', false)
  assertOk(deleteError, 'objectives delete failed')

  const { data: inserted, error: insertError } = await env.db.from('objectives').insert(
    objectives.map((o, i) => ({
      adventure_id: env.adventure.id,
      chapter_id: chapterId,
      index: i,
      title: o.title,
      hidden_description: o.hiddenDescription,
      completion_predicates: o.completionPredicates,
    })),
  ).select('id, title, hidden_description, completion_predicates')
  assertOk(insertError, 'objectives insert failed')

  // Guaranteed routes (overhaul Phase 4): a code-authored rescue encounter per objective,
  // whose success provably satisfies that objective's predicate. Needs the row ids, so it
  // runs after the insert. A predicate with no writable satisfying set yields no route - the
  // objective is then only completable by its authored paths, which the Phase-5 reachability
  // lint will flag rather than this stage papering over.
  for (const row of ((inserted ?? []) as {
    id: string; title: string; hidden_description: string | null; completion_predicates: unknown
  }[])) {
    const route = buildGuaranteedRoute({
      objectiveId: row.id,
      title: row.title,
      hiddenDescription: row.hidden_description ?? undefined,
      completionPredicates: row.completion_predicates,
    })
    if (!route) continue
    const { error: routeError } = await env.db
      .from('objectives')
      .update({ guaranteed_route: route as unknown as Json })
      .eq('id', row.id)
    if (routeError) console.error('guaranteed_route write failed', routeError)
  }

  // The atom registry mirrors whatever predicates exist right now (overhaul Phase 1).
  await syncSpineAtoms(env.db, env.adventure.id)

  await enqueueJob(env.db, env.adventure.id, 4, chapterId)
}
