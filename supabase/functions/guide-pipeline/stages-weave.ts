// Stages 6-7: Hook Weaver cross-links and the Consistency pass over the whole guide.
import { buildStage6Prompt, parseStage6 } from '../_shared/guide/stages/stage6.ts'
import type { GuideDigest } from '../_shared/guide/stages/stage6.ts'
import {
  buildStage7Prompt, buildStage7RepairPrompt, parseStage7, parseStage7Repair, REPAIRABLE_FIELDS,
  validateRegistryCoverage,
} from '../_shared/guide/stages/stage7.ts'
import type { EntityRef, WarningDraft } from '../_shared/guide/types.ts'
import { enqueueJob, type StageEnv } from './stage-env.ts'
import { assertOk, buildDigest, logPipelineEvent } from './util.ts'

export async function runStage6(env: StageEnv): Promise<void> {
  const { digest, refs, objectiveIdByHandle } = await buildDigest(env.db, env.adventure.id)

  const { hooks, contracts } = await env.generate('hook_weaver', buildStage6Prompt(digest), (raw) => parseStage6(raw, digest))

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
 * One repair round per stage-7 run - the same shape as live play's consistency loop (check ->
 * constrained regeneration -> re-check -> fail open). More rounds would chase the checker's
 * nondeterminism, and the residue ships as ordinary warnings either way.
 */
const REPAIR_CAP = 6

/** The repairable text fields of one row, loaded verbatim for the repair prompt. */
async function loadRepairFields(
  env: StageEnv,
  table: string,
  id: string,
): Promise<{ fields: Record<string, string>; humanEdited: boolean; content: Record<string, unknown> | null } | null> {
  const columns: Record<string, string> = {
    objectives: 'title, hidden_description, human_edited',
    npcs: 'description, human_edited',
    locations: 'description, human_edited',
    ingredients: 'content, reveals, human_edited',
  }
  const { data, error } = await env.db.from(table).select(columns[table]).eq('id', id).maybeSingle()
  if (error || !data) return null
  const row = data as Record<string, unknown>
  const content = (row.content ?? null) as Record<string, unknown> | null
  const fields: Record<string, string> = {}
  for (const field of REPAIRABLE_FIELDS[table] ?? []) {
    const value = field === 'text' ? content?.text : row[field]
    fields[field] = typeof value === 'string' ? value : ''
  }
  return { fields, humanEdited: row.human_edited === true, content }
}

/**
 * Attempt one ROW's repair, resolving every warning that targets it in a single constrained
 * rewrite - one repair per row is what makes the parallel fan-out safe (two same-row repairs
 * raced and the second wrote a stale spoiler title back over the first's fix, live 2026-07-22).
 * Applied only when the model both claims and produces a valid patch. Every applied repair logs
 * a guide_repair event with before/after - loud by design (F04 SS2 amendment). Any failure
 * inside is this row's problem alone: its warnings survive to the re-check, the stage never
 * dies for it.
 */
async function attemptRepair(
  env: StageEnv,
  warnings: WarningDraft[],
  ref: { table: string; id: string },
  digest: GuideDigest,
  arc: string,
): Promise<boolean> {
  const handle = warnings[0].targetHandle!
  try {
    const loaded = await loadRepairFields(env, ref.table, ref.id)
    if (!loaded || loaded.humanEdited) return false

    const repair = await env.generate(
      'consistency_checker',
      buildStage7RepairPrompt({
        handle,
        table: ref.table,
        warnings: warnings.map((w) => w.message),
        fields: loaded.fields,
        digest,
        metaLoopArc: arc,
      }),
      (raw) => parseStage7Repair(raw, ref.table),
    )
    if (!repair.resolvable) return false

    // Logical 'text' lives inside the ingredients content jsonb; everything else is a column.
    const patch: Record<string, unknown> = {}
    for (const [field, value] of Object.entries(repair.patch)) {
      if (ref.table === 'ingredients' && field === 'text') {
        patch.content = { ...(loaded.content ?? {}), text: value }
      } else {
        patch[field] = value
      }
    }
    const { error } = await env.db.from(ref.table).update(patch).eq('id', ref.id)
    if (error) return false

    await logPipelineEvent(env.db, env.adventure.id, 'guide_repair', {
      handle,
      table: ref.table,
      warning: warnings.map((w) => w.message).join(' | '),
      note: repair.note,
      before: Object.fromEntries(
        Object.keys(repair.patch).map((f) => [f, (loaded.fields[f] ?? '').slice(0, 300)]),
      ),
      after: Object.fromEntries(Object.entries(repair.patch).map(([f, v]) => [f, v.slice(0, 300)])),
    })
    return true
  } catch (err) {
    console.error(`stage-7 repair failed for ${handle}`, err)
    return false
  }
}

export async function runStage7(env: StageEnv): Promise<void> {
  const { digest, refs } = await buildDigest(env.db, env.adventure.id)
  const arc = env.adventure.meta_loop?.arc ?? ''

  const found = await env.generate(
    'consistency_checker',
    buildStage7Prompt(digest, arc),
    (raw) => parseStage7(raw, digest),
  )

  // Auto-repair (2026-07-22): findings are grouped by TARGET ROW - one repair reconciles all
  // of a row's warnings - then rows repair in parallel (they share nothing). Row-less findings
  // (coverage, guide-level observations) and human-edited rows stay warnings; capped so a
  // pathological checker cannot spend the stage's wall clock on rewrites.
  const byRow = new Map<string, { ref: { table: string; id: string }; warnings: WarningDraft[] }>()
  for (const w of found) {
    const ref = w.targetHandle ? refs.get(w.targetHandle) : null
    if (!ref || (REPAIRABLE_FIELDS[ref.table] ?? []).length === 0) continue
    const key = `${ref.table}:${ref.id}`
    const entry = byRow.get(key) ?? { ref, warnings: [] }
    entry.warnings.push(w)
    byRow.set(key, entry)
  }
  const eligible = [...byRow.values()]
  const attempted = eligible.slice(0, REPAIR_CAP)
  const applied = (
    await Promise.all(attempted.map((row) => attemptRepair(env, row.warnings, row.ref, digest, arc)))
  ).filter(Boolean).length

  // Repairs change the guide, so the shipped warnings must describe the guide as it now IS:
  // re-run the same check over a fresh digest and keep only what still fails. No repairs
  // applied means the first pass already describes reality - skip the second call.
  let residue = found
  if (applied > 0) {
    try {
      const rebuilt = await buildDigest(env.db, env.adventure.id)
      residue = await env.generate(
        'consistency_checker',
        buildStage7Prompt(rebuilt.digest, arc),
        (raw) => parseStage7(raw, rebuilt.digest),
      )
    } catch (err) {
      // The re-check is a luxury: with it gone, the pre-repair findings ship (over-warning
      // about content that may now be fixed beats a stage failure after rows were written).
      console.error('stage-7 re-check failed, shipping pre-repair findings', err)
    }
  }

  await logPipelineEvent(env.db, env.adventure.id, 'guide_repair_summary', {
    found: found.length,
    eligible: eligible.length,
    attempted: attempted.length,
    applied,
    residual: residue.length,
  })

  const { error: deleteError } = await env.db
    .from('guide_warnings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('stage', 7)
  assertOk(deleteError, 'stage-7 warning cleanup failed')

  const warningRows = residue.map((w) => {
    const ref = w.targetHandle ? refs.get(w.targetHandle) : null
    return {
      adventure_id: env.adventure.id,
      stage: 7,
      target_table: ref?.table ?? null,
      target_id: ref?.id ?? null,
      message: w.message,
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
    warningRows.push({ adventure_id: env.adventure.id, stage: 7, target_table: null, target_id: null, message })
  }

  if (warningRows.length > 0) {
    const { error } = await env.db.from('guide_warnings').insert(warningRows)
    assertOk(error, 'warnings insert failed')
  }

  // The Ending Designer (stage 8, F04 SS4.2) runs last and flips guide_ready.
  await enqueueJob(env.db, env.adventure.id, 8)
}
