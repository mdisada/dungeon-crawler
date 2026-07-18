// Stages 6-7: Hook Weaver cross-links and the Consistency pass over the whole guide.
import { buildStage6Prompt, parseStage6 } from '../_shared/guide/stages/stage6.ts'
import { buildStage7Prompt, parseStage7, validateRegistryCoverage } from '../_shared/guide/stages/stage7.ts'
import type { EntityRef } from '../_shared/guide/types.ts'
import { enqueueJob, type StageEnv } from './stage-env.ts'
import { assertOk, buildDigest } from './util.ts'

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

export async function runStage7(env: StageEnv): Promise<void> {
  const { digest, refs } = await buildDigest(env.db, env.adventure.id)
  const arc = env.adventure.meta_loop?.arc ?? ''

  const warnings = await env.generate(
    'consistency_checker',
    buildStage7Prompt(digest, arc),
    (raw) => parseStage7(raw, digest),
  )

  const { error: deleteError } = await env.db
    .from('guide_warnings')
    .delete()
    .eq('adventure_id', env.adventure.id)
    .eq('stage', 7)
  assertOk(deleteError, 'stage-7 warning cleanup failed')

  const warningRows = warnings.map((w) => {
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
