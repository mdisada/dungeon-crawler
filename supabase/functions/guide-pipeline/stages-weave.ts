// Stages 6-7: Hook Weaver cross-links and the Consistency pass over the whole guide.
import { buildStage6Prompt, parseStage6 } from '../_shared/guide/stages/stage6.ts'
import {
  buildStage7EditPlanPrompt, buildStage7Prompt, parseStage7, parseStage7EditPlan,
  REPAIRABLE_FIELDS, validateRegistryCoverage,
} from '../_shared/guide/stages/stage7.ts'
import { buildGroupClassifierPrompt, groupNpcIds, parseGroupClassifier } from '../_shared/guide/group-npcs.ts'
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
  const { error: warnError } = await env.db.from('guide_warnings').insert(warningRows)
  assertOk(warnError, 'group warnings insert failed')

  await logPipelineEvent(env.db, env.adventure.id, 'group_npc_reclassified', {
    removed: removed.map((n) => n.name),
    kept_human_edited: groups.filter((n) => n.human_edited).map((n) => n.name),
  })
}

export async function runStage6(env: StageEnv): Promise<void> {
  // Drop groups that slipped through as NPC rows BEFORE the digest is built - hooks, contracts
  // and objective links must never reference a row that is about to disappear.
  await reclassifyGroupNpcs(env)

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

  await enqueueJob(env.db, env.adventure.id, 7)
}

/**
 * Repair rounds per stage-7 run (user-directed 2026-07-22): loop check -> repair -> re-check
 * until the checker returns CLEAN or this cap hits. Bounded because each round costs a full
 * checker pass plus repairs (~15s) inside a 150s worker, and because the checker is
 * nondeterministic - it can keep finding new things to say forever; three rounds converge or
 * the residue goes to the review popup. The loop also breaks early when a round applies
 * nothing: re-checking unchanged content would only re-report the same findings.
 */
const MAX_REPAIR_ROUNDS = 3

/** The repairable fields of one row, loaded verbatim for the repair prompt. */
async function loadRepairFields(
  env: StageEnv,
  table: string,
  id: string,
  chapters: { id: string; number: number; title: string }[],
): Promise<{ fields: Record<string, string>; humanEdited: boolean; content: Record<string, unknown> | null } | null> {
  const columns: Record<string, string> = {
    objectives: 'title, hidden_description, chapter_id, completion_predicates, human_edited',
    npcs: 'description, chapter_id, human_edited',
    locations: 'description, chapter_id, human_edited',
    ingredients: 'content, reveals, human_edited',
  }
  const { data, error } = await env.db.from(table).select(columns[table]).eq('id', id).maybeSingle()
  if (error || !data) return null
  const row = data as Record<string, unknown>
  const content = (row.content ?? null) as Record<string, unknown> | null
  const fields: Record<string, string> = {}
  for (const field of REPAIRABLE_FIELDS[table] ?? []) {
    if (field === 'chapter') {
      // Current placement, in the same vocabulary the patch uses ("2" | "global").
      fields.chapter = row.chapter_id ? String(chapters.find((c) => c.id === row.chapter_id)?.number ?? '?') : 'global'
      continue
    }
    if (field === 'completion_predicates') {
      // Shown (and patched) as a JSON string; stored as jsonb.
      fields.completion_predicates = JSON.stringify(row.completion_predicates ?? null)
      continue
    }
    const value = field === 'text' ? content?.text : row[field]
    fields[field] = typeof value === 'string' ? value : ''
  }
  return { fields, humanEdited: row.human_edited === true, content }
}

/**
 * Apply ONE validated edit from the round's plan: logical fields become columns (ingredient
 * 'text' -> content jsonb; 'chapter' -> chapter_id, the structural MOVE), guarded by the
 * stage-6 invariant (the entry contract's giver never leaves chapter 1) and objective-index
 * appending. Logs the guide_repair event with before/after - loud by design (F04 SS2
 * amendment). Returns whether anything was written.
 */
async function applyEdit(
  env: StageEnv,
  edit: { handle: string; patch: Record<string, string>; note: string },
  ref: { table: string; id: string },
  loaded: { fields: Record<string, string>; content: Record<string, unknown> | null },
  chapters: { id: string; number: number; title: string }[],
  entryGiverIds: Set<string>,
  findingsForHandle: string[],
): Promise<boolean> {
  try {
    const patch: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(edit.patch)) {
      if (ref.table === 'ingredients' && field === 'text') {
        patch.content = { ...(loaded.content ?? {}), text: value }
      } else if (field === 'completion_predicates') {
        // Parser already validated grammar/no-facts/claimability; stored as jsonb.
        patch.completion_predicates = JSON.parse(value)
      } else if (field === 'chapter') {
        // Drop only a guarded move; the edit's text fields still apply.
        if (ref.table === 'npcs' && entryGiverIds.has(ref.id)) continue
        // A "move" to the current chapter is a no-op - and for objectives it would still
        // append-to-end, silently reordering the ladder (chapter "3" -> "3", live 2026-07-22).
        if (value === (loaded.fields.chapter ?? '')) continue
        const target = value === 'global' ? null : chapters.find((ch) => ch.number === Number(value))?.id
        if (value !== 'global' && !target) continue
        patch.chapter_id = target
        if (ref.table === 'objectives' && target) {
          // Append to the target chapter's ladder - deterministic ordering, no index collisions.
          const { data: siblings } = await env.db
            .from('objectives')
            .select('index')
            .eq('chapter_id', target)
            .order('index', { ascending: false })
            .limit(1)
          patch.index = ((siblings?.[0]?.index as number | undefined) ?? -1) + 1
        }
      } else {
        patch[field] = value
      }
    }
    if (Object.keys(patch).length === 0) return false
    const { error } = await env.db.from(ref.table).update(patch).eq('id', ref.id)
    if (error) return false

    await logPipelineEvent(env.db, env.adventure.id, 'guide_repair', {
      handle: edit.handle,
      table: ref.table,
      warning: findingsForHandle.join(' | '),
      note: edit.note,
      before: Object.fromEntries(
        Object.keys(edit.patch).map((f) => [f, (loaded.fields[f] ?? '').slice(0, 300)]),
      ),
      after: Object.fromEntries(Object.entries(edit.patch).map(([f, v]) => [f, v.slice(0, 300)])),
    })
    return true
  } catch (err) {
    console.error(`stage-7 edit failed for ${edit.handle}`, err)
    return false
  }
}

export async function runStage7(env: StageEnv): Promise<void> {
  const arc = env.adventure.meta_loop?.arc ?? ''
  // The entry contract's giver must stay a chapter-1/global NPC (stage-6 invariant) - loaded
  // once; ids are stable across rounds even when rows move.
  const { data: entryContracts } = await env.db
    .from('quest_contracts')
    .select('giver_npc_id')
    .eq('adventure_id', env.adventure.id)
    .eq('is_entry', true)
  const entryGiverIds = new Set(((entryContracts ?? []) as { giver_npc_id: string | null }[])
    .map((k) => k.giver_npc_id)
    .filter((id): id is string => id !== null))

  // Convergence loop (user-directed 2026-07-22): check -> ONE edit-plan call that fixes every
  // row-targeted finding together -> re-check the CHANGED guide -> again, until clean or
  // MAX_REPAIR_ROUNDS. A single planned call is what fixes contradiction CLUSTERS (five
  // findings, one root, every affected row aligned in one pass) - and it replaced the per-row
  // parallel fan-out that tripped the edge runtime's concurrent-fetch ceiling (7 parallel
  // repairs, 0 completed, live 2026-07-22). Each round re-derives digest AND refs: a chapter
  // move renumbers handles, so the previous round's refs are stale the moment a move applies.
  // Row-less findings (coverage, guide-level observations) and human-edited rows stay warnings.
  let current = await buildDigest(env.db, env.adventure.id)
  let findings = await env.generate(
    'consistency_checker',
    buildStage7Prompt(current.digest, arc),
    (raw) => parseStage7(raw, current.digest),
  )
  const firstFound = findings.length
  let rounds = 0
  let totalPlanned = 0
  let totalApplied = 0
  while (rounds < MAX_REPAIR_ROUNDS && findings.length > 0) {
    // The round's editable surface: flagged rows that exist, are editable, and are not
    // human-edited. Loaded sequentially - burst DB fetches share the same outbound-fetch
    // ceiling the parallel repairs died on.
    const targeted = findings.filter((w): w is WarningDraft & { targetHandle: string } => {
      const ref = w.targetHandle ? current.refs.get(w.targetHandle) : null
      return Boolean(ref && (REPAIRABLE_FIELDS[ref.table] ?? []).length > 0)
    })
    if (targeted.length === 0) break
    const rowByHandle = new Map<string, { table: string; id: string; fields: Record<string, string>; content: Record<string, unknown> | null }>()
    for (const handle of new Set(targeted.map((w) => w.targetHandle))) {
      const ref = current.refs.get(handle)!
      const loaded = await loadRepairFields(env, ref.table, ref.id, current.chapters)
      if (loaded && !loaded.humanEdited) {
        rowByHandle.set(handle, { table: ref.table, id: ref.id, fields: loaded.fields, content: loaded.content })
      }
    }
    const planWarnings = targeted.filter((w) => rowByHandle.has(w.targetHandle))
    // Row-less findings (registry coverage, guide-level) reach the planner too - their fix,
    // when one exists, is CREATING the missing entity (user-directed 2026-07-22).
    const rowless = findings.filter((w) => !w.targetHandle).map((w) => w.message)
    if (planWarnings.length === 0 && rowless.length === 0) break

    // Existing cast names guard creates against duplicates; reloaded per round because a
    // create changes the answer.
    const [{ data: npcNames }, { data: locationNames }] = await Promise.all([
      env.db.from('npcs').select('name').eq('adventure_id', env.adventure.id),
      env.db.from('locations').select('name').eq('adventure_id', env.adventure.id),
    ])
    const existingNames = new Set(
      [...(npcNames ?? []), ...(locationNames ?? [])].map((r) => String(r.name).trim().toLowerCase()),
    )

    rounds++
    let edits
    try {
      edits = await env.generate(
        'consistency_checker',
        buildStage7EditPlanPrompt({
          warnings: planWarnings.map((w) => ({ handle: w.targetHandle, message: w.message })),
          rowlessWarnings: rowless,
          rows: [...rowByHandle.entries()].map(([handle, r]) => ({ handle, table: r.table, fields: r.fields })),
          digest: current.digest,
          metaLoopArc: arc,
          chapters: current.chapters.map(({ number, title }) => ({ number, title })),
        }),
        (raw) => parseStage7EditPlan(raw, new Set(rowByHandle.keys()), current.chapters.length, existingNames),
      )
    } catch (err) {
      // The plan call failing is not worth the stage - the findings simply ship as warnings.
      console.error('stage-7 edit plan failed', err)
      break
    }
    if (edits.length === 0) break
    totalPlanned += edits.length
    let applied = 0
    for (const edit of edits) {
      if (edit.create) {
        const table = edit.create.kind === 'npc' ? 'npcs' : 'locations'
        const chapterId = edit.create.chapter === 'global'
          ? null
          : current.chapters.find((ch) => ch.number === Number(edit.create!.chapter))?.id ?? null
        const { error } = await env.db.from(table).insert({
          adventure_id: env.adventure.id,
          chapter_id: chapterId,
          name: edit.create.name,
          description: edit.create.description,
        })
        if (!error) {
          applied++
          await logPipelineEvent(env.db, env.adventure.id, 'guide_repair', {
            handle: '(new)',
            table,
            warning: rowless.slice(0, 2).join(' | '),
            note: edit.note,
            before: {},
            after: { name: edit.create.name, description: edit.create.description.slice(0, 300), chapter: edit.create.chapter },
          })
        } else {
          console.error('stage-7 create failed', error)
        }
        continue
      }
      const row = edit.handle ? rowByHandle.get(edit.handle) : undefined
      if (!row) continue
      const findingsForHandle = planWarnings.filter((w) => w.targetHandle === edit.handle).map((w) => w.message)
      if (await applyEdit(env, edit as { handle: string; patch: Record<string, string>; note: string }, { table: row.table, id: row.id }, row, current.chapters, entryGiverIds, findingsForHandle)) {
        applied++
      }
    }
    totalApplied += applied
    if (applied === 0) break

    // Re-check describes the guide as it now IS - and feeds the next round. A re-check
    // failure is not worth the stage: ship the last round's findings as the residue
    // (over-warning about content that may now be fixed beats dying after rows were written).
    try {
      current = await buildDigest(env.db, env.adventure.id)
      findings = await env.generate(
        'consistency_checker',
        buildStage7Prompt(current.digest, arc),
        (raw) => parseStage7(raw, current.digest),
      )
    } catch (err) {
      console.error('stage-7 re-check failed, shipping last findings', err)
      break
    }
  }
  const residue = findings

  await logPipelineEvent(env.db, env.adventure.id, 'guide_repair_summary', {
    found: firstFound,
    rounds,
    attempted: totalPlanned,
    applied: totalApplied,
    residual: residue.length,
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
