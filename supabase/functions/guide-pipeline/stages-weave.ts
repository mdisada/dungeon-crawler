// Stages 6-7: Hook Weaver cross-links and the Consistency pass over the whole guide.
import { buildStage6Prompt, parseStage6 } from '../_shared/guide/stages/stage6.ts'
import { buildStage7Prompt, parseStage7, validateRegistryCoverage } from '../_shared/guide/stages/stage7.ts'
import { buildGroupClassifierPrompt, groupNpcIds, parseGroupClassifier } from '../_shared/guide/group-npcs.ts'
import { buildPersonalSlotsPrompt, parsePersonalSlots, personalAtoms } from '../_shared/guide/personal.ts'
import { downgradeUnstageableNodes, pruneNodeNpcIds } from '../_shared/guide/nodes.ts'
import type { EncounterSpec } from '../_shared/guide/group-npcs.ts'
import type { EntityRef, WarningDraft } from '../_shared/guide/types.ts'
import { enqueueJob, type StageEnv } from './stage-env.ts'
import { assertOk, buildDigest, logPipelineEvent } from './util.ts'

const GROUP_WARNING_PREFIX = 'NPC that is really a group: '

/**
 * A group masquerading as an NPC, removed structurally now that every chapter's encounters exist.
 * A non-boss npc row whose name is a COUNTABLE enemy (count >= 2) is a TYPE, not a person - the
 * same call session/npc-state.ts makes at play time, made here so the row never reaches play. The
 * group survives correctly as its encounter enemies plus a lore registry entry; the npc row is
 * dropped, ingredient placements pointing at it are cleared, and each removal is logged + warned.
 * Human-edited rows are never deleted - they warn instead, leaving the creator in charge.
 *
 * Runs FIRST in stage 6, before the digest is built, so hooks/contracts/links never reference a
 * row that is about to disappear.
 */
async function reclassifyGroupNpcs(env: StageEnv): Promise<void> {
  const [npcResult, encounterResult] = await Promise.all([
    env.db.from('npcs').select('id, name, role, description, faction, human_edited').eq('adventure_id', env.adventure.id),
    env.db.from('encounters').select('spec').eq('adventure_id', env.adventure.id),
  ])
  assertOk(npcResult.error, 'group-check npcs load failed')
  assertOk(encounterResult.error, 'group-check encounters load failed')

  // Bosses are individuals by definition, even when fought - never a candidate for removal.
  const candidates = ((npcResult.data ?? []) as {
    id: string; name: string; description: string; faction: string; role: string; human_edited: boolean
  }[]).filter((n) => n.role !== 'boss')
  const encounters = ((encounterResult.data ?? []) as { spec: EncounterSpec | null }[]).map((e) => e.spec ?? {})

  // Deterministic tell (count>=2 enemy) - near-zero false positives.
  const groupIds = new Set(groupNpcIds(candidates, encounters))

  // Semantic pass for groups/forces with NO combat tell (a purely-social "Merchant Council").
  // A classifier failure is never worth the stage - fall back to the deterministic set alone.
  if (candidates.length > 0) {
    try {
      const indexes = await env.generate(
        'consistency_checker',
        buildGroupClassifierPrompt(candidates.map((n) => ({ name: n.name, description: n.description, faction: n.faction }))),
        (raw) => parseGroupClassifier(raw, candidates.length),
      )
      for (const i of indexes) if (candidates[i]) groupIds.add(candidates[i].id)
    } catch (err) {
      console.error('group classifier failed, using deterministic groups only', err)
    }
  }

  // Any run replaces only its own warnings - a group fixed by hand since the last run must clear.
  const { error: cleanupError } = await env.db
    .from('guide_warnings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('stage', 6)
    .like('message', `${GROUP_WARNING_PREFIX}%`)
  assertOk(cleanupError, 'group warning cleanup failed')

  if (groupIds.size === 0) return

  const groups = candidates.filter((n) => groupIds.has(n.id))
  // Human-edited rows are kept (the creator is in charge) and only warned; the rest are removed.
  const removed = groups.filter((n) => !n.human_edited)
  const deleteIds = removed.map((n) => n.id)

  if (deleteIds.length > 0) {
    // Clear placement.npc_id on any ingredient pointing at a row we are about to delete, so a
    // clue is not left tied to a speaker that no longer exists. Loaded and rewritten in JS -
    // placement is jsonb with no FK, so there is no cascade to lean on.
    const { data: ingredients, error: ingLoadError } = await env.db
      .from('ingredients')
      .select('id, placement')
      .eq('adventure_id', env.adventure.id)
    assertOk(ingLoadError, 'group-check ingredients load failed')
    const deleteSet = new Set(deleteIds)
    for (const ing of (ingredients ?? []) as { id: string; placement: Record<string, unknown> | null }[]) {
      const placement = ing.placement ?? {}
      if (typeof placement.npc_id === 'string' && deleteSet.has(placement.npc_id)) {
        const { npc_id: _removed, ...rest } = placement
        const { error } = await env.db.from('ingredients').update({ placement: rest }).eq('id', ing.id)
        assertOk(error, 'ingredient placement cleanup failed')
      }
    }

    const { error: deleteError } = await env.db.from('npcs').delete().in('id', deleteIds)
    assertOk(deleteError, 'group npc delete failed')
  }

  // Reclassify the registry so a REMOVED entity survives as lore (a named group, never an agent)
  // and stage 7's coverage check does not then flag the row we just removed as "missing". Both
  // the global registry (meta_loop) and every chapter's list must flip, or a global lore entity
  // is "uncovered" by a chapter that still calls it an npc. Kept (human-edited) rows are left
  // classified as npc - their row still exists, so lore would be the lie.
  const removedNamesLower = new Set(removed.map((n) => n.name.trim().toLowerCase()))
  const matchesGroup = (e: EntityRef) => removedNamesLower.has(e.name.trim().toLowerCase())

  const meta = env.adventure.meta_loop
  const metaEntities: EntityRef[] = meta?.entities ?? []
  if (meta && metaEntities.some((e) => matchesGroup(e) && e.kind !== 'lore')) {
    const entities = metaEntities.map((e) => (matchesGroup(e) ? { ...e, kind: 'lore' as const } : e))
    const { error } = await env.db.from('adventures').update({ meta_loop: { ...meta, entities } }).eq('id', env.adventure.id)
    assertOk(error, 'group registry reclassification failed')
  }

  const { data: chapterRows, error: chapterError } = await env.db
    .from('chapters')
    .select('id, entities')
    .eq('adventure_id', env.adventure.id)
  assertOk(chapterError, 'group-check chapters load failed')
  for (const chapter of (chapterRows ?? []) as { id: string; entities: EntityRef[] | null }[]) {
    const entities = chapter.entities ?? []
    if (!entities.some((e) => matchesGroup(e) && e.kind !== 'lore')) continue
    const updated = entities.map((e) => (matchesGroup(e) ? { ...e, kind: 'lore' as const } : e))
    const { error } = await env.db.from('chapters').update({ entities: updated }).eq('id', chapter.id)
    assertOk(error, 'group chapter reclassification failed')
  }

  // THE PROSE OUTLIVES THE ROW. Everything above cleans the STRUCTURED references - npc_ids,
  // ingredient placements, both registries - and none of it touches what the scenes SAY. A node
  // keeps its label "Present Warden Selk with the evidence of the Cursed Silver" after Selk stops
  // existing, and the narrator, reading the scene it was given, stages him: 7 of 26 narrations in
  // run 15fc82be, one of them handing him spoken dialogue.
  //
  // Reported rather than rewritten, deliberately. Repairing this prose means an LLM rewrite per
  // node, and the stage-7 repair loop was deleted this same day precisely because model rewrites
  // of guide prose made guides worse in 8 of 8 measured cases. A warning the creator can act on is
  // worth more than an edit nobody can trust. The runtime half is covered separately: canon now
  // tells the narrator a force is not a person, so a surviving label is far less likely to become
  // a speaking character.
  const proseWarnings: { node: string; name: string }[] = []
  if (removed.length > 0) {
    const { data: nodeRows, error: nodeError } = await env.db
      .from('story_nodes')
      .select('key, label, narration_seed')
      .eq('adventure_id', env.adventure.id)
    assertOk(nodeError, 'group-check story_nodes load failed')
    for (const node of (nodeRows ?? []) as { key: string; label: string; narration_seed: string }[]) {
      const blob = `${node.label ?? ''} ${node.narration_seed ?? ''}`
      for (const gone of removed) {
        if (blob.includes(gone.name)) proseWarnings.push({ node: node.key, name: gone.name })
      }
    }
  }

  const warningRows = groups.map((n) => ({
    adventure_id: env.adventure.id,
    stage: 6,
    target_table: 'npcs',
    // A deleted row has no id left to point at; an edited (kept) row does.
    target_id: n.human_edited ? n.id : null,
    message: n.human_edited
      ? `${GROUP_WARNING_PREFIX}"${n.name}" reads as a group or force rather than a single person, but ` +
        `was left as-is because you edited it. A group cannot hold one conversation or one death - split ` +
        `it into a named individual, or delete this NPC.`
      : `${GROUP_WARNING_PREFIX}"${n.name}" was generated as an NPC but reads as a group or force, not a ` +
        `single person, so the NPC row was removed. If the party needs to interact with it, add a named ` +
        `individual who represents it (an envoy, a captain).`,
    // Auto-removed rows are a record of a fix; a kept (human-edited) row needs a human.
    kind: n.human_edited ? 'warning' : 'info',
  }))
  const proseWarningRows = proseWarnings.map(({ node, name }) => ({
    adventure_id: env.adventure.id,
    stage: 6,
    target_table: 'story_nodes',
    target_id: null,
    message: `${GROUP_WARNING_PREFIX}scene "${node}" still names "${name}" in its label or opening, but ` +
      `that NPC row was removed as a group. Nothing can stage, voice or track them, so the scene reads ` +
      `as though someone is there who is not. Rewrite the scene around a named individual, or around ` +
      `the force itself rather than a person.`,
    kind: 'warning',
  }))
  const { error: warnError } = await env.db.from('guide_warnings').insert([...warningRows, ...proseWarningRows])
  assertOk(warnError, 'group warnings insert failed')

  await logPipelineEvent(env.db, env.adventure.id, 'group_npc_reclassified', {
    removed: removed.map((n) => n.name),
    kept_human_edited: groups.filter((n) => n.human_edited).map((n) => n.name),
    // Named so the size of the residue is on the record, not just its existence.
    orphaned_scenes: proseWarnings.map((p) => `${p.node}:${p.name}`),
  })
}

export async function runStage6(env: StageEnv): Promise<void> {
  // Drop groups that slipped through as NPC rows BEFORE the digest is built - hooks, contracts
  // and objective links must never reference a row that is about to disappear.
  await reclassifyGroupNpcs(env)

  // Those deletions can orphan a social node stage 5 authored against the living roster. Repair
  // it here rather than letting the stage-8 gate refuse the guide four retries later.
  await repairOrphanedSocialNodes(env).catch((err) => {
    console.error('social node repair failed', err)
  })

  const { digest, refs, objectiveIdByHandle, entryGiverHandles } = await buildDigest(env.db, env.adventure.id)

  const { hooks, contracts } = await env.generate(
    'hook_weaver',
    buildStage6Prompt(digest, entryGiverHandles),
    (raw) => parseStage6(raw, digest, entryGiverHandles),
  )

  const { error: deleteError } = await env.db.from('hooks').delete().eq('adventure_id', env.adventure.id)
  assertOk(deleteError, 'hooks delete failed')

  // Quest contracts (F04 SS4.3): the entry giver must be a first-chapter (or global) NPC so
  // the offer can land in the opening scene - hard validation, a bad ref is a stage failure.
  const entry = contracts.find((k) => k.isEntry)!
  const entryGiverRef = refs.get(entry.giverHandle)
  if (!entryGiverRef || entryGiverRef.table !== 'npcs') throw new Error('entry contract giver did not resolve to an NPC')
  const [{ data: giverRow }, { data: firstChapter }] = await Promise.all([
    env.db.from('npcs').select('chapter_id').eq('id', entryGiverRef.id).maybeSingle(),
    env.db.from('chapters').select('id').eq('adventure_id', env.adventure.id).order('index').limit(1).maybeSingle(),
  ])
  if (giverRow?.chapter_id && firstChapter && giverRow.chapter_id !== firstChapter.id) {
    throw new Error('entry contract giver must appear in the first chapter (the offer opens the adventure)')
  }

  // Re-runs preserve creator-edited contracts (guide-editor convention); an edited entry
  // contract also suppresses the generated one (entry uniqueness is a hard constraint).
  const { data: editedRows, error: editedError } = await env.db
    .from('quest_contracts')
    .select('id, is_entry')
    .eq('adventure_id', env.adventure.id)
    .eq('human_edited', true)
  assertOk(editedError, 'edited contracts load failed')
  const keepEntry = (editedRows ?? []).some((r) => r.is_entry)
  const { error: contractsDelete } = await env.db
    .from('quest_contracts')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('human_edited', false)
  assertOk(contractsDelete, 'contracts delete failed')
  const contractRows = contracts
    .filter((k) => !(k.isEntry && keepEntry))
    .map((k) => {
      const giver = refs.get(k.giverHandle)!
      const objectiveIds = k.objectiveHandles.map((h) => objectiveIdByHandle.get(h)).filter(Boolean)
      return {
        adventure_id: env.adventure.id,
        chapter_id: null,
        label: k.label,
        giver_npc_id: giver.id,
        is_entry: k.isEntry,
        reward: { gold_floor: k.goldFloor, gold_ceiling: k.goldCeiling, extras: k.extras },
        stakes: k.stakes,
        deadline: k.deadlineDays ? { days: k.deadlineDays } : null,
        objective_ids: objectiveIds,
      }
    })
  if (contractRows.length > 0) {
    const { error: contractsInsert } = await env.db.from('quest_contracts').insert(contractRows)
    assertOk(contractsInsert, 'contracts insert failed')
  }

  const { error: insertError } = await env.db.from('hooks').insert(
    hooks.map((h) => ({
      adventure_id: env.adventure.id,
      from_ref: h.fromHandle ? refs.get(h.fromHandle)! : { table: 'backstory', id: null },
      to_objective_id: objectiveIdByHandle.get(h.toObjectiveHandle)!,
      hook_text: h.hookText,
      kind: h.kind,
    })),
  )
  assertOk(insertError, 'hooks insert failed')

  // Derive the objective link chips (SS5.1) from the woven hooks.
  const linkedNpcs = new Map<string, string[]>()
  const linkedLocations = new Map<string, string[]>()
  for (const h of hooks) {
    const objectiveId = objectiveIdByHandle.get(h.toObjectiveHandle)
    const from = h.fromHandle ? refs.get(h.fromHandle) : null
    if (!objectiveId || !from) continue
    if (from.table === 'npcs') {
      linkedNpcs.set(objectiveId, [...new Set([...(linkedNpcs.get(objectiveId) ?? []), from.id])])
    } else if (from.table === 'locations') {
      linkedLocations.set(objectiveId, [...new Set([...(linkedLocations.get(objectiveId) ?? []), from.id])])
    }
  }
  for (const objectiveId of objectiveIdByHandle.values()) {
    const { error } = await env.db
      .from('objectives')
      .update({
        linked_npc_ids: linkedNpcs.get(objectiveId) ?? [],
        linked_location_ids: linkedLocations.get(objectiveId) ?? [],
      })
      .eq('id', objectiveId)
    assertOk(error, 'objective links update failed')
  }

  // Personal hook slots (2026-07-26): per-player stakes authored against archetypes, bound to
  // real characters at first session. Additive - a failure here must not cost the whole guide.
  await authorPersonalSlots(env).catch((err) => {
    console.error('personal slot authoring failed', err)
  })

  await enqueueJob(env.db, env.adventure.id, 7)
}

/**
 * A social node whose staged cast no longer exists becomes a skill challenge carrying the SAME
 * outcome maps - the runtime's own tier-bridge downgrade, applied at authoring time so the node
 * never reaches the reachability gate broken.
 */
async function repairOrphanedSocialNodes(env: StageEnv): Promise<void> {
  const [{ data: nodeRows }, { data: npcRows }] = await Promise.all([
    env.db.from('story_nodes').select('id, key, kind, encounter_spec').eq('adventure_id', env.adventure.id),
    env.db.from('npcs').select('id, initial_state').eq('adventure_id', env.adventure.id),
  ])
  const nodes = ((nodeRows ?? []) as { id: string; key: string; kind: string; encounter_spec: unknown }[])
  if (nodes.length === 0) return
  const living = ((npcRows ?? []) as { id: string; initial_state: string | null }[])
    .filter((n) => (n.initial_state ?? 'alive') !== 'dead' && (n.initial_state ?? 'alive') !== 'absent')
    .map((n) => n.id)

  const specOf = (raw: unknown) =>
    (typeof raw === 'object' && raw !== null ? raw : {}) as Record<string, unknown>
  const npcIdsOf = (raw: unknown): string[] => {
    const params = specOf(specOf(raw).params)
    return Array.isArray(params.npc_ids) ? params.npc_ids.filter((x): x is string => typeof x === 'string') : []
  }

  // Strike removed cast from every node FIRST, including the ones that keep their kind. A node
  // staging [alive, deleted] survives the downgrade below with the deleted id still in its spec,
  // and resolveNpcNames then throws "NPC <uuid> not found" at open time - the beat goes stillborn
  // and the director burns a rung re-planning it (live 2026-07-26, three times on one node).
  for (const p of pruneNodeNpcIds(nodes.map((n) => ({ key: n.key, npcIds: npcIdsOf(n.encounter_spec) })), living)) {
    const row = nodes.find((n) => n.key === p.key)
    if (!row) continue
    const spec = specOf(row.encounter_spec)
    const params = { ...specOf(spec.params), npc_ids: p.npcIds }
    const { error } = await env.db
      .from('story_nodes').update({ encounter_spec: { ...spec, params } }).eq('id', row.id)
    if (error) continue
    row.encounter_spec = { ...spec, params }
    await logPipelineEvent(env.db, env.adventure.id, 'story_node_cast_pruned', {
      node_key: p.key, removed: p.removed, remaining: p.npcIds.length,
    })
  }

  const downgrades = downgradeUnstageableNodes(
    nodes.map((n) => ({ key: n.key, kind: n.kind as 'social', npcIds: npcIdsOf(n.encounter_spec) })),
    living,
  )
  for (const d of downgrades) {
    const row = nodes.find((n) => n.key === d.key)
    if (!row) continue
    const spec = { ...specOf(row.encounter_spec), kind: d.to }
    const { error } = await env.db
      .from('story_nodes').update({ kind: d.to, encounter_spec: spec }).eq('id', row.id)
    if (error) continue
    await logPipelineEvent(env.db, env.adventure.id, 'story_node_downgraded', {
      node_key: d.key, from: d.from, to: d.to, reason: d.reason,
    })
  }
}

/**
 * Author `max_players + 1` personal slots and register their atoms at PERSONAL scope, which is
 * what lets the stage-8 lint prove no private arc ever sits in a structural position.
 */
async function authorPersonalSlots(env: StageEnv): Promise<void> {
  const { data: nodeRows } = await env.db
    .from('story_nodes')
    .select('key, label, narration_seed')
    .eq('adventure_id', env.adventure.id)
    .eq('role', 'route')
    .order('key')
  const nodes = ((nodeRows ?? []) as { key: string; label: string; narration_seed: string }[])
    .map((n) => ({ key: n.key, summary: `${n.label} - ${String(n.narration_seed).slice(0, 120)}` }))
  // No authored graph (legacy guide): overlays would have nowhere to attach.
  if (nodes.length === 0) return

  const meta = (env.adventure.meta_loop ?? {}) as { premise?: string; arc?: string }
  const wanted = Math.min((env.adventure.max_players ?? 4) + 1, 8)
  const ctx = { nodeKeys: nodes.map((n) => n.key), wanted }
  const slots = await env.generate(
    'hook_weaver',
    buildPersonalSlotsPrompt({ premise: meta.premise ?? '', arc: meta.arc ?? '', wanted, nodes }),
    (raw) => parsePersonalSlots(raw, ctx),
  )
  if (slots.length === 0) return

  const { error: delError } = await env.db
    .from('personal_slots').delete().eq('adventure_id', env.adventure.id).eq('human_edited', false)
  assertOk(delError, 'personal_slots delete failed')

  const { error: insertError } = await env.db.from('personal_slots').insert(
    slots.map((s) => ({
      adventure_id: env.adventure.id,
      key: s.key,
      archetype: {
        background_tags: s.archetype.backgroundTags,
        class_keys: s.archetype.classKeys,
        themes: s.archetype.themes,
      },
      intro_seed: s.introSeed,
      objective_template: { label: s.objective.label, predicate: s.objective.predicate, reward: s.objective.reward },
      overlay_attachments: s.overlays.map((o) => ({ node_key: o.nodeKey, overlay_seed: o.overlaySeed })),
    })),
  )
  assertOk(insertError, 'personal_slots insert failed')

  // Registry rows at PERSONAL scope - the marker the lint and applyMilestones both key off.
  const atomRows = slots.flatMap((s) =>
    personalAtoms(s).map((slug) => ({
      adventure_id: env.adventure.id, slug, kind: 'flag', scope: 'personal',
      label: slug, source_table: 'personal_slots', source_id: null,
    })),
  )
  if (atomRows.length > 0) {
    const { error } = await env.db
      .from('story_atoms').upsert(atomRows, { onConflict: 'adventure_id,slug', ignoreDuplicates: true })
    assertOk(error, 'personal atom registration failed')
  }
  await logPipelineEvent(env.db, env.adventure.id, 'personal_slots_authored', { count: slots.length })
}

/**
 * Repair rounds per stage-7 run (user-directed 2026-07-22): loop check -> repair -> re-check
 * until the checker returns CLEAN or this cap hits. Bounded because each round costs a full
 * checker pass plus repairs (~15s) inside a 150s worker, and because the checker is
 * nondeterministic - it can keep finding new things to say forever; three rounds converge or
 * the residue goes to the review popup. The loop also breaks early when a round applies
 * nothing: re-checking unchanged content would only re-report the same findings.
 */

export async function runStage7(env: StageEnv): Promise<void> {
  const arc = env.adventure.meta_loop?.arc ?? ''
  // CHECK ONLY (2026-07-28). Stage 7 reports contradictions; it no longer rewrites rows.
  //
  // The convergence loop that used to live here - check, plan one batch of edits, re-check, revert
  // the round if majors did not fall - was measured over every guide generated to date and stalled
  // on all eight, reverting each time. 28 edits planned across the sample, 0 survived; majors rose
  // in seven of eight (5 -> 14 on 77451545, 1 -> 6 on 98a5ea7d). It cost a checker pass plus an
  // edit-plan call per round and never once left a guide better.
  //
  // Detection is worth keeping and is genuinely good - stage 7 independently caught the
  // unregistered ship "Miriam's Promise" that the structural gates cannot see. So the findings
  // still ship as warnings for the creator, and the guide reaches guide_ready describing itself
  // honestly instead of having been edited toward a checker that was not converging.
  const current = await buildDigest(env.db, env.adventure.id)
  const residue = await env.generate(
    'consistency_checker',
    buildStage7Prompt(current.digest, arc),
    (raw) => parseStage7(raw, current.digest),
  )

  await logPipelineEvent(env.db, env.adventure.id, 'guide_check_summary', {
    found: residue.length,
    major: residue.filter((w) => w.severity === 'major').length,
    minor: residue.filter((w) => w.severity === 'minor').length,
  })

  const { error: deleteError } = await env.db
    .from('guide_warnings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('stage', 7)
  assertOk(deleteError, 'stage-7 warning cleanup failed')

  const warningRows = residue.map((w) => {
    // current.refs, never the first round's: chapter moves renumber handles between rounds,
    // and the residue was parsed against the FINAL digest.
    const ref = w.targetHandle ? current.refs.get(w.targetHandle) : null
    return {
      adventure_id: env.adventure.id,
      stage: 7,
      target_table: ref?.table ?? null,
      target_id: ref?.id ?? null,
      message: w.message,
      // Majors go to the review popup; minors are worth recording, not worth a click
      // (severity ranked by the checker, 2026-07-22 "user clicks less").
      kind: w.severity === 'minor' ? 'info' : 'warning',
    }
  })

  // Deterministic registry-coverage check (F04 SS2.1): flag global entities that never landed.
  const [chapterRows, npcRows, locationRows] = await Promise.all([
    env.db.from('chapters').select('entities').eq('adventure_id', env.adventure.id),
    env.db.from('npcs').select('name').eq('adventure_id', env.adventure.id),
    env.db.from('locations').select('name').eq('adventure_id', env.adventure.id),
  ])
  for (const res of [chapterRows, npcRows, locationRows]) assertOk(res.error, 'stage-7 coverage load failed')
  const chapterEntities = (chapterRows.data ?? []).flatMap((c) => (c.entities as EntityRef[] | null) ?? [])
  const coverageWarnings = validateRegistryCoverage(
    env.adventure.meta_loop?.entities ?? [],
    chapterEntities,
    (npcRows.data ?? []).map((n) => n.name as string),
    (locationRows.data ?? []).map((l) => l.name as string),
  )
  for (const message of coverageWarnings) {
    // kind must be EXPLICIT here: this array also holds residue rows that carry kind, and a
    // PostgREST bulk insert fills a row's missing keys with NULL - not the column default -
    // which violated the not-null constraint and failed the stage (live 2026-07-22).
    warningRows.push({ adventure_id: env.adventure.id, stage: 7, target_table: null, target_id: null, message, kind: 'warning' })
  }

  if (warningRows.length > 0) {
    const { error } = await env.db.from('guide_warnings').insert(warningRows)
    assertOk(error, 'warnings insert failed')
  }

  // The Ending Designer (stage 8, F04 SS4.2) runs last and flips guide_ready.
  await enqueueJob(env.db, env.adventure.id, 8)
}
