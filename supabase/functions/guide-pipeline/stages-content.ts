// Stages 4-5: Ingredient Generator and Encounter Designer, per chapter.
import { expectedPartyLevel, expectedPartySize } from '../_shared/guide/budget.ts'
import { deriveNpcStatBlock } from '../_shared/guide/npc-stats.ts'
import { buildStage4Prompt, parseStage4 } from '../_shared/guide/stages/stage4.ts'
import { buildStage5Prompt, parseStage5 } from '../_shared/guide/stages/stage5.ts'
import type { EntityRef } from '../_shared/guide/types.ts'
import { enqueueJob, type StageEnv } from './stage-env.ts'
import { chapterSketch, loadChapterScenes } from './stages-story.ts'
import { assertOk, difficultyOf, slugKeys, toSeed } from './util.ts'

async function loadChapter(env: StageEnv, chapterId: string) {
  const { data, error } = await env.db
    .from('chapters')
    .select('id, index, title, arc_summary, entities')
    .eq('id', chapterId)
    .single()
  assertOk(error, 'chapter load failed')
  return data!
}

async function loadChapterObjectives(env: StageEnv, chapterId: string) {
  const { data, error } = await env.db
    .from('objectives')
    .select('id, index, title, hidden_description')
    .eq('chapter_id', chapterId)
    .order('index')
    .order('created_at')
  assertOk(error, 'objectives load failed')
  return (data ?? []).map((o) => ({
    id: o.id as string,
    title: o.title as string,
    hiddenDescription: o.hidden_description as string,
    completionPredicates: null,
  }))
}

export async function runStage4(env: StageEnv, chapterId: string): Promise<void> {
  if (!env.adventure.meta_loop) throw new Error('meta_loop missing - stage 1 must run first')
  const chapter = await loadChapter(env, chapterId)
  const scenes = await loadChapterScenes(env, chapterId)
  const objectives = await loadChapterObjectives(env, chapterId)

  // Entities from other chapters are reusable by slug key instead of duplicating them.
  const { data: otherNpcs, error: npcError } = await env.db
    .from('npcs')
    .select('id, name')
    .eq('adventure_id', env.adventure.id)
    .neq('chapter_id', chapterId)
    .order('created_at')
  assertOk(npcError, 'npcs load failed')
  const { data: otherLocations, error: locError } = await env.db
    .from('locations')
    .select('id, name')
    .eq('adventure_id', env.adventure.id)
    .neq('chapter_id', chapterId)
    .order('created_at')
  assertOk(locError, 'locations load failed')
  const existingNpcs = slugKeys(otherNpcs ?? [], 'npc')
  const existingLocations = slugKeys(otherLocations ?? [], 'loc')

  const ctx = {
    seed: toSeed(env.adventure),
    metaLoop: env.adventure.meta_loop,
    chapter: chapterSketch(chapter),
    chapterNumber: chapter.index + 1,
    scenes,
    objectives,
    requiredEntities: (chapter.entities as EntityRef[] | null) ?? [],
    existingNpcs: existingNpcs.list.map(({ key, name }) => ({ key, name })),
    existingLocations: existingLocations.list.map(({ key, name }) => ({ key, name })),
  }
  const output = await env.generate('ingredient_generator', buildStage4Prompt(ctx), (raw) => parseStage4(raw, ctx))

  // Replace this chapter's previously generated (untouched) content.
  for (const table of ['ingredients', 'coop_sets', 'npcs', 'locations']) {
    const { error } = await env.db.from(table).delete().eq('chapter_id', chapterId).eq('human_edited', false)
    assertOk(error, `${table} delete failed`)
  }

  const npcIdByKey = new Map<string, string>(existingNpcs.list.map(({ key, row }) => [key, row.id]))
  const newNpcs = output.npcs.filter((n) => !npcIdByKey.has(n.key))
  if (newNpcs.length > 0) {
    const { data, error } = await env.db
      .from('npcs')
      .insert(
        newNpcs.map((n) => ({
          adventure_id: env.adventure.id,
          chapter_id: chapterId,
          name: n.name,
          role: n.role,
          initial_state: n.initialState,
          personality: n.personality,
          faction: n.faction,
          description: n.description,
          image_prompt: n.imagePrompt,
          stat_block: deriveNpcStatBlock(n.combat, n.role),
        })),
      )
      .select('id')
    assertOk(error, 'npcs insert failed')
    newNpcs.forEach((n, i) => npcIdByKey.set(n.key, data![i].id))
  }

  const locationIdByKey = new Map<string, string>(existingLocations.list.map(({ key, row }) => [key, row.id]))
  const newLocations = output.locations.filter((l) => !locationIdByKey.has(l.key))
  if (newLocations.length > 0) {
    const { data, error } = await env.db
      .from('locations')
      .insert(
        newLocations.map((l) => ({
          adventure_id: env.adventure.id,
          chapter_id: chapterId,
          name: l.name,
          description: l.description,
          image_prompt: l.imagePrompt,
        })),
      )
      .select('id')
    assertOk(error, 'locations insert failed')
    newLocations.forEach((l, i) => locationIdByKey.set(l.key, data![i].id))
  }

  const coopIdByKey = new Map<string, string>()
  if (output.coopSets.length > 0) {
    const { data, error } = await env.db
      .from('coop_sets')
      .insert(
        output.coopSets.map((s) => ({
          adventure_id: env.adventure.id,
          chapter_id: chapterId,
          kind: s.kind,
          reveals: s.reveals,
        })),
      )
      .select('id')
    assertOk(error, 'coop_sets insert failed')
    output.coopSets.forEach((s, i) => coopIdByKey.set(s.key, data![i].id))
  }

  const { error: ingredientError } = await env.db.from('ingredients').insert(
    output.ingredients.map((ing) => ({
      adventure_id: env.adventure.id,
      chapter_id: chapterId,
      type: ing.type,
      content: ing.content,
      placement: {
        ...(ing.placement.locationKey ? { location_id: locationIdByKey.get(ing.placement.locationKey) } : {}),
        ...(ing.placement.npcKey ? { npc_id: npcIdByKey.get(ing.placement.npcKey) } : {}),
        ...(ing.placement.condition ? { condition: ing.placement.condition } : {}),
      },
      reveals: ing.reveals,
      pillar_tags: ing.pillarTags,
      reveals_to: ing.revealsTo,
      coop_set_id: ing.coopSetKey ? coopIdByKey.get(ing.coopSetKey) : null,
      objective_links: ing.objectiveIndexes.map((i) => objectives[i]?.id).filter(Boolean),
    })),
  )
  assertOk(ingredientError, 'ingredients insert failed')

  // SS4.1 conformance issues are repaired (nonconforming coop sets demoted), not stage failures;
  // surface each repair as a stage-4 warning, replacing this chapter's previous batch - same
  // pattern as stage 5's budget warnings.
  const warningPrefix = `Chapter ${chapter.index + 1} coop: `
  const { error: oldWarnError } = await env.db
    .from('guide_warnings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('stage', 4)
    .like('message', `${warningPrefix}%`)
  assertOk(oldWarnError, 'stage-4 warning cleanup failed')
  if (output.warnings.length > 0) {
    const { error: warnError } = await env.db.from('guide_warnings').insert(
      output.warnings.map((w) => ({
        adventure_id: env.adventure.id,
        stage: 4,
        message: `${warningPrefix}${w}`,
      })),
    )
    assertOk(warnError, 'stage-4 warnings insert failed')
  }

  await enqueueJob(env.db, env.adventure.id, 5, chapterId)
}

export async function runStage5(env: StageEnv, chapterId: string): Promise<void> {
  const chapter = await loadChapter(env, chapterId)
  const objectives = await loadChapterObjectives(env, chapterId)

  const { data: chapterNpcs, error: npcError } = await env.db
    .from('npcs')
    .select('id, name, role, human_edited, pending_regen')
    .eq('chapter_id', chapterId)
    .order('created_at')
  assertOk(npcError, 'npcs load failed')
  const { data: chapterLocations, error: locError } = await env.db
    .from('locations')
    .select('id, name')
    .eq('chapter_id', chapterId)
    .order('created_at')
  assertOk(locError, 'locations load failed')

  const npcKeys = slugKeys(chapterNpcs ?? [], 'npc')
  const locationKeys = slugKeys(chapterLocations ?? [], 'loc')
  const seed = toSeed(env.adventure)

  const ctx = {
    chapter: chapterSketch(chapter),
    chapterNumber: chapter.index + 1,
    objectives,
    npcs: npcKeys.list.map(({ key, name, row }) => ({ key, name, role: row.role as 'npc' | 'boss' })),
    locations: locationKeys.list.map(({ key, name }) => ({ key, name })),
    difficultyPreset: difficultyOf(env.adventure),
    partyLevel: expectedPartyLevel(seed, chapter.index),
    partySize: expectedPartySize(seed),
  }
  const output = await env.generate('encounter_designer', buildStage5Prompt(ctx), (raw) => parseStage5(raw, ctx))

  // Replace generated encounters (and their stage-5 budget warnings) for this chapter.
  const { data: oldEncounters, error: oldError } = await env.db
    .from('encounters')
    .select('id')
    .eq('chapter_id', chapterId)
    .eq('human_edited', false)
  assertOk(oldError, 'encounters load failed')
  if ((oldEncounters ?? []).length > 0) {
    const oldIds = (oldEncounters ?? []).map((e) => e.id)
    const { error: warnError } = await env.db.from('guide_warnings').delete().eq('stage', 5).in('target_id', oldIds)
    assertOk(warnError, 'stage-5 warning cleanup failed')
    const { error: encError } = await env.db.from('encounters').delete().in('id', oldIds)
    assertOk(encError, 'encounters delete failed')
  }

  const { data: inserted, error: insertError } = await env.db
    .from('encounters')
    .insert(
      output.encounters.map((e) => ({
        adventure_id: env.adventure.id,
        chapter_id: chapterId,
        type: e.type,
        spec: e.spec,
        budget: e.budget ?? {},
        location_id: e.locationKey ? locationKeys.byKey.get(e.locationKey)?.id : null,
      })),
    )
    .select('id')
  assertOk(insertError, 'encounters insert failed')

  const encounterIdsByObjective = new Map<string, string[]>()
  output.encounters.forEach((e, i) => {
    const objectiveId = objectives[e.objectiveIndex]?.id
    if (!objectiveId) return
    encounterIdsByObjective.set(objectiveId, [...(encounterIdsByObjective.get(objectiveId) ?? []), inserted![i].id])
  })
  for (const objective of objectives) {
    const { error } = await env.db
      .from('objectives')
      .update({ encounter_ids: encounterIdsByObjective.get(objective.id) ?? [] })
      .eq('id', objective.id)
    assertOk(error, 'objective encounter_ids update failed')
  }

  const budgetWarnings = output.encounters
    .map((e, i) => ({ e, id: inserted![i].id }))
    .filter(({ e }) => e.budget && e.budget.verdict !== 'within')
  if (budgetWarnings.length > 0) {
    const { error } = await env.db.from('guide_warnings').insert(
      budgetWarnings.map(({ e, id }) => ({
        adventure_id: env.adventure.id,
        stage: 5,
        target_table: 'encounters',
        target_id: id,
        message: `Battle encounter is ${e.budget!.verdict} budget: ${e.budget!.adjustedXp} adjusted XP vs a ${e.budget!.xpBudget} XP ${ctx.difficultyPreset} target for ${ctx.partySize} level-${ctx.partyLevel} characters.`,
      })),
    )
    assertOk(error, 'budget warnings insert failed')
  }

  for (const update of output.bossUpdates) {
    const npc = npcKeys.byKey.get(update.npcKey)
    if (!npc) continue
    const fields = { tactics_profile: update.tacticsProfile, boss_phases: update.bossPhases }
    // Human-edited NPCs get a proposal instead of an overwrite (F04 SS7).
    const patch = npc.human_edited
      ? { pending_regen: { ...((npc.pending_regen as object | null) ?? {}), ...fields } }
      : fields
    const { error } = await env.db.from('npcs').update(patch).eq('id', npc.id)
    assertOk(error, 'boss update failed')
  }

  // Last chapter to clear stage 5 starts the whole-guide weave.
  const { data: remaining, error: remainingError } = await env.db
    .from('guide_jobs')
    .select('id')
    .eq('adventure_id', env.adventure.id)
    .lte('stage', 5)
    .in('status', ['queued', 'running'])
    .neq('id', env.currentJobId)
  assertOk(remainingError, 'remaining jobs check failed')
  if ((remaining ?? []).length === 0) {
    await enqueueJob(env.db, env.adventure.id, 6)
  }
}
