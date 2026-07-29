// Stages 4-5: Ingredient Generator and Encounter Designer, per chapter.
import { expectedPartyLevel, expectedPartySize } from '../_shared/guide/budget.ts'
import { deriveNpcStatBlock } from '../_shared/guide/npc-stats.ts'
import { buildStage4Prompt, parseStage4 } from '../_shared/guide/stages/stage4.ts'
import { buildStage5Prompt, parseStage5 } from '../_shared/guide/stages/stage5.ts'
import {
  buildRescueNode, buildStage5NodesPrompt, parseStage5Nodes,
} from '../_shared/guide/stages/stage5-nodes.ts'
import type { Stage5NodesContext, Stage5NodesOutput } from '../_shared/guide/stages/stage5-nodes.ts'
import type { StoryNodeSpec } from '../_shared/guide/nodes.ts'
import type { GuaranteedRoute } from '../_shared/guide/guaranteed-route.ts'
import { minimalSatisfyingAtoms } from '../_shared/guide/guaranteed-route.ts'
import { canonicalizeAtomSlug } from '../_shared/story/index.ts'
import type { EntityRef, Json } from '../_shared/guide/types.ts'
import { enqueueJob, type StageEnv } from './stage-env.ts'
import { chapterSketch, loadChapterScenes } from './stages-story.ts'
import { assertOk, difficultyOf, logPipelineEvent, slugKeys, toSeed } from './util.ts'

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
    .select('id, index, title, hidden_description, completion_predicates, guaranteed_route')
    .eq('chapter_id', chapterId)
    .order('index')
    .order('created_at')
  assertOk(error, 'objectives load failed')
  return (data ?? []).map((o) => ({
    id: o.id as string,
    title: o.title as string,
    hiddenDescription: o.hidden_description as string,
    // Real predicates, not the null placeholder this used to carry: stage 5 derives each
    // encounter's award atoms from the objective it serves (Phase 5).
    completionPredicates: o.completion_predicates as unknown,
    // The code-authored rescue route (stage 3), materialized as a rescue node by stage 5.
    guaranteedRoute: o.guaranteed_route as unknown,
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
    .select('id, name, role, description, initial_state')
    .eq('adventure_id', env.adventure.id)
    .neq('chapter_id', chapterId)
    .order('created_at')
  assertOk(npcError, 'npcs load failed')
  const { data: otherLocations, error: locError } = await env.db
    .from('locations')
    .select('id, name, description')
    .eq('adventure_id', env.adventure.id)
    .neq('chapter_id', chapterId)
    .order('created_at')
  assertOk(locError, 'locations load failed')
  const existingNpcs = slugKeys(otherNpcs ?? [], 'npc')
  const existingLocations = slugKeys(otherLocations ?? [], 'loc')

  // What earlier chapters already made true of these entities. Their own row is one source;
  // every ingredient placed on them is another - an NPC's secrets ARE facts about them, and
  // that is where the contradictions came from (a wife in one chapter, the poisoner in another).
  const { data: priorIngredients } = await env.db
    .from('ingredients')
    .select('reveals, placement')
    .eq('adventure_id', env.adventure.id)
    .neq('chapter_id', chapterId)
  const revealsByEntityId = new Map<string, string[]>()
  for (const row of (priorIngredients ?? []) as { reveals: string; placement: Record<string, unknown> }[]) {
    const id = (row.placement?.npc_id ?? row.placement?.location_id) as string | undefined
    if (!id || !row.reveals) continue
    revealsByEntityId.set(id, [...(revealsByEntityId.get(id) ?? []), row.reveals])
  }
  const npcFacts = (row: { id: string; role?: string; description?: string; initial_state?: string }) => [
    row.description ?? '',
    row.role === 'boss' ? 'is the chapter villain' : '',
    row.initial_state && row.initial_state !== 'alive' ? `is ${row.initial_state} when play begins` : '',
    ...(revealsByEntityId.get(row.id) ?? []),
  ].filter(Boolean)

  const ctx = {
    seed: toSeed(env.adventure),
    metaLoop: env.adventure.meta_loop,
    chapter: chapterSketch(chapter),
    chapterNumber: chapter.index + 1,
    scenes,
    objectives,
    requiredEntities: (chapter.entities as EntityRef[] | null) ?? [],
    existingNpcs: existingNpcs.list.map(({ key, name, row }) => ({ key, name, facts: npcFacts(row) })),
    existingLocations: existingLocations.list.map(({ key, name, row }) => ({
      key,
      name,
      facts: [row.description ?? '', ...(revealsByEntityId.get(row.id) ?? [])].filter(Boolean),
    })),
  }
  const output = await env.generate('ingredient_generator', buildStage4Prompt(ctx), (raw) => parseStage4(raw, ctx))

  // Stage 1 files groups under `npc` ("Silver Scale Guild guards"); stage 4, told an NPC is one
  // person, declines to make them people. Persist that correction to the registry so stage 5,
  // stage 8, the coverage contract and canon all stop treating a faction as somebody who can be
  // met - and so a regeneration does not fight the same battle over again. This is the entity
  // classification being repaired by the stage best placed to judge it.
  if (output.reclassifyAsLore.length > 0) {
    const meta = env.adventure.meta_loop as { entities?: { kind: string; name: string; note: string }[] }
    const wanted = new Set(output.reclassifyAsLore.map((n) => n.toLowerCase().trim()))
    const entities = (meta.entities ?? []).map((e) =>
      wanted.has(e.name.toLowerCase().trim()) ? { ...e, kind: 'lore' } : e)
    const { error } = await env.db
      .from('adventures')
      .update({ meta_loop: { ...meta, entities } })
      .eq('id', env.adventure.id)
    assertOk(error, 'entity reclassification failed')
    await logPipelineEvent(env.db, env.adventure.id, 'entity_reclassified', {
      chapter_id: chapterId, names: output.reclassifyAsLore, from: 'npc', to: 'lore',
    })
  }

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
        // The demotion already resolved the problem - a record, not a call to action.
        kind: 'info',
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
    .select('id, name, role, description, initial_state, human_edited, pending_regen')
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
        // Award surface (Phase 5), DERIVED not authored: the designer already declares which
        // objective this encounter serves, and the objective's predicate already determines
        // what completing it requires - so the atoms follow deterministically. Code owns
        // identity (MAIN-SPEC §1.1(2a)); asking a model to re-pick them would only add drift.
        outcome_atoms: minimalSatisfyingAtoms(
          objectives[e.objectiveIndex]?.completionPredicates ?? null,
        ) as unknown as Json,
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
        // Post-rebalance everything sits under the lethal ceiling, so 'over' is deliberate
        // difficulty spread (info); 'under' is an effectively empty battle - needs a human.
        kind: e.budget!.verdict === 'over' ? 'info' : 'warning',
      })),
    )
    assertOk(error, 'budget warnings insert failed')
  }

  // Deterministic trims made by the parser (an unsurvivable encounter cut down to size) are
  // recorded too - the guide still generates, but the DM sees what was changed and why.
  if (output.warnings.length > 0) {
    const { error } = await env.db.from('guide_warnings').insert(
      output.warnings.map((message) => ({
        adventure_id: env.adventure.id,
        stage: 5,
        target_table: 'encounters',
        target_id: null,
        message,
        // Deterministic rebalances and dropped surplus tactics - records, not calls to action.
        kind: 'info',
      })),
    )
    assertOk(error, 'stage-5 trim warnings insert failed')
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

  // --- Author the playable story-node graph for this chapter (overhaul 2026-07-26) ---
  // The beat planner + encounter designer, moved out of runtime: >= 2 route nodes per objective
  // plus the materialized rescue node, all pre-linted before guide_ready.
  const keyedNpcs: KeyedNpc[] = npcKeys.list.map(({ key, name, row }) => ({
    key, name, id: row.id, initialState: row.initial_state,
    // WHO they are travels with WHAT they are called - see Stage5NodesContext.npcs.
    role: row.role as string | undefined, description: row.description as string | undefined,
  }))
  const keyedLocations: KeyedLocation[] = locationKeys.list.map(({ key, name, row }) => ({
    key, name, id: row.id as string,
  }))
  await authorChapterNodes(env, chapterId, objectives, keyedNpcs, keyedLocations, chapter)

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

/** snake_case stored encounter spec - the exact shape the runtime openBeatSpec reads, plus the
 *  pre-resolved npc_ids for social nodes. */
function storedSpec(node: StoryNodeSpec, npcIds: string[]): Json {
  const e = node.encounter
  const params = (typeof e.params === 'object' && e.params !== null && !Array.isArray(e.params)
    ? e.params
    : {}) as Record<string, unknown>
  return {
    kind: e.kind, label: e.label, stakes: e.stakes, rationale: e.rationale,
    // npc_ids live INSIDE params - where openSocialEncounter and route-health's stillborn
    // detector both read them from.
    params: { ...params, ...(npcIds.length > 0 ? { npc_ids: npcIds } : {}) },
    on_success: e.onSuccess, on_partial: e.onPartial, on_failure: e.onFailure,
  } as unknown as Json
}

/** `{win, loss}` as stored, or null when neither was authored - a node with nothing to say about
 *  its own aftermath should read as absent, not as two empty strings later code has to test. */
function storedOutcome(node: StoryNodeSpec): Json {
  const { win, loss } = node.outcomeSummary
  return win || loss ? ({ win, loss } as unknown as Json) : null
}

function storedTransitions(node: StoryNodeSpec): Json {
  return node.transitions.map((t) => ({
    on: t.on, to_node_key: t.toNodeKey, arrival_context: t.arrivalContext,
  })) as unknown as Json
}

type Stage5Objective = {
  id: string; title: string; hiddenDescription: string
  completionPredicates: unknown; guaranteedRoute: unknown
}

interface KeyedNpc {
  key: string; name: string; id: string; initialState: string
  role?: string; description?: string
}
interface KeyedLocation { key: string; name: string; id: string }

async function authorChapterNodes(
  env: StageEnv,
  chapterId: string,
  objectives: Stage5Objective[],
  npcs: KeyedNpc[],
  locations: KeyedLocation[],
  chapter: { index: number; title: string },
): Promise<void> {
  const living = npcs.filter((n) => n.initialState !== 'dead' && n.initialState !== 'absent')
  const npcIdByKey = new Map(npcs.map((n) => [n.key, n.id]))
  const locationIdByKey = new Map(locations.map((l) => [l.key, l.id]))
  const ctx: Stage5NodesContext = {
    chapterNumber: chapter.index + 1,
    chapterTitle: chapter.title,
    objectives: objectives.map((o) => ({
      id: o.id, title: o.title, hiddenDescription: o.hiddenDescription, completionPredicates: o.completionPredicates,
    })),
    npcs: living.map(({ key, name, role, description }) => ({ key, name, role, description })),
    locations: locations.map(({ key, name }) => ({ key, name })),
    // Stage 2 planned this chapter's scenes and stages 3 and 4 were both given them; only the
    // stage that authors the PLAYABLE scenes was not. See Stage5NodesContext.scenes.
    scenes: (await loadChapterScenes(env, chapterId)).map((s) => s.sketch).filter(Boolean),
    partySkills: [],
  }
  // ONE CALL PER OBJECTIVE, not per chapter (2026-07-29).
  //
  // This authored every node in the chapter in a single call. On glm-5.2 that ran to 4000 output
  // tokens - exactly the cap, so the reply was TRUNCATED - and took 83s, which with the in-
  // invocation retry blew the edge function's ~150s wall clock and failed the guide four times
  // running. The truncation is a property of the CALL SIZE, not the model: flash-lite averaged
  // 1006 tokens for the same work today, but that headroom shrinks as chapters grow.
  //
  // Splitting is safe for the authoring rules because every cross-node rule stage 5 enforces is
  // WITHIN one objective - "route 2's seed must still be true after route 1 was lost" is about an
  // objective's own ladder. What a per-objective call loses is sight of its SIBLINGS, so their
  // titles travel in `otherObjectiveTitles` to stop the threads reusing each other's ground.
  const output: Stage5NodesOutput = { nodes: [], localAtoms: [] }
  for (const objective of ctx.objectives) {
    const single: Stage5NodesContext = {
      ...ctx,
      objectives: [objective],
      otherObjectiveTitles: ctx.objectives.filter((o) => o.id !== objective.id).map((o) => o.title),
    }
    const part = await env.generate(
      'beat_planner',
      buildStage5NodesPrompt(single),
      (raw) => parseStage5Nodes(raw, single),
    )
    output.nodes.push(...part.nodes)
    output.localAtoms.push(...part.localAtoms)
  }

  // Register every declared setback atom (scope 'local') so the stage-8 gate does not flag it as
  // off-registry. Upsert-ignore keeps spine atoms and prior locals intact.
  const localBySlug = new Map<string, { name: string; kind: string }>()
  for (const a of output.localAtoms) {
    const slug = canonicalizeAtomSlug(a.name)
    if (slug && !localBySlug.has(slug)) localBySlug.set(slug, a)
  }
  if (localBySlug.size > 0) {
    const rows = [...localBySlug].map(([slug, a]) => ({
      adventure_id: env.adventure.id, slug, kind: a.kind, scope: 'local',
      label: a.name, source_table: 'story_nodes', source_id: null,
    }))
    const { error } = await env.db
      .from('story_atoms')
      .upsert(rows, { onConflict: 'adventure_id,slug', ignoreDuplicates: true })
    assertOk(error, 'local atom registration failed')
  }

  // Replace this chapter's previously generated nodes (keep human-edited ones).
  const { error: delError } = await env.db
    .from('story_nodes').delete().eq('chapter_id', chapterId).eq('human_edited', false)
  assertOk(delError, 'story_nodes delete failed')

  const objectiveId = (objectiveKey: string) => objectiveKey.replace(/^obj:/, '')
  const rows: Record<string, unknown>[] = []
  for (const { node, npcKeys: keys } of output.nodes) {
    const npcIds = keys.map((k) => npcIdByKey.get(k)).filter((id): id is string => Boolean(id))
    rows.push({
      adventure_id: env.adventure.id, chapter_id: chapterId, objective_id: objectiveId(node.objectiveKey),
      key: node.key, index: node.index, kind: node.kind, role: node.role, label: node.label,
      narration_seed: node.narrationSeed, encounter_spec: storedSpec(node, npcIds),
      outcome_summary: storedOutcome(node),
      // Resolved here, exactly as npc keys are: the model authors a key from a closed list and the
      // orchestrator turns it into an id. An unresolvable key stores null - "wherever the party
      // is" - rather than a dangling reference.
      location_id: node.locationKey ? locationIdByKey.get(node.locationKey) ?? null : null,
      affordances: node.affordances as unknown as Json, transitions: storedTransitions(node),
      local_atoms: node.localAtoms as unknown as Json,
      // The plot fact this beat makes true when it RESOLVES, at any tier. Derived from the
      // objective's predicate; the encounter spec's outcome maps carry flavour only.
      // See docs/DECISIONS.md 2026-07-29.
      establishes: node.establishes,
    })
  }
  // Materialize each objective's rescue node from its guaranteed route.
  for (const o of objectives) {
    if (!o.guaranteedRoute) continue
    const node = buildRescueNode(o.id, o.guaranteedRoute as GuaranteedRoute)
    rows.push({
      adventure_id: env.adventure.id, chapter_id: chapterId, objective_id: o.id,
      key: node.key, index: node.index, kind: node.kind, role: node.role, label: node.label,
      narration_seed: node.narrationSeed, encounter_spec: storedSpec(node, []),
      outcome_summary: storedOutcome(node),
      // Rescue nodes stay unplaced on purpose - see buildRescueNode.
      location_id: null,
      affordances: node.affordances as unknown as Json, transitions: storedTransitions(node),
      local_atoms: [] as unknown as Json,
      // A rescue is the floor a spent party is dropped onto, so its plot fact must not be
      // conditional on winning it - objective 0 of run 9a5f87a6 lost its canon on a 0-2 roll.
      establishes: node.establishes,
    })
  }
  if (rows.length > 0) {
    const { error } = await env.db.from('story_nodes').insert(rows)
    assertOk(error, 'story_nodes insert failed')
  }
  await logPipelineEvent(env.db, env.adventure.id, 'story_nodes_authored', {
    chapter_id: chapterId, route_nodes: output.nodes.length, rescue_nodes: rows.length - output.nodes.length,
  })
}
