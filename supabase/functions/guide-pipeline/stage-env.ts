// Execution environment handed to each stage: DB access, the adventure row, and a
// generate-and-parse LLM helper that retries once with validation feedback before failing the
// job (mirrors ai-proxy's retry-once contract for structured output, F01 SS3.2).
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { ParseResult } from '../_shared/guide/types.ts'
import { assertOk, type AdventureRow } from './util.ts'

export interface StagePrompt {
  system: string
  user: string
  maxTokens: number
  /**
   * Strict JSON Schema for the reply, when the stage has one. Constrained decoding is the only
   * thing that makes a long document's SYNTAX someone else's problem: stage 4 hand-wrote ~20k
   * characters per call and broke its own JSON mid-document at position 13383 of 19k (live
   * 2026-07-31), on top of an omitted field and an out-of-range count the week before - three
   * failures a schema forecloses outright. llm.ts drops the schema and retries as prose if a
   * provider rejects it, so a stage that supplies one is never worse off than one that does not.
   */
  schema?: { name: string; schema: Record<string, unknown> }
}

export interface StageEnv {
  db: SupabaseClient
  adventure: AdventureRow
  currentJobId: string
  /**
   * The validator errors this job's PREVIOUS attempt died on (persisted on the job row). A stage
   * that ran out of wall-clock budget requeues cold; feeding these into the fresh invocation's
   * first call recovers the in-invocation feedback that a cross-invocation retry otherwise loses.
   */
  priorError: string | null
  generate: <T>(agentRole: string, prompt: StagePrompt, parse: (raw: string) => ParseResult<T>) => Promise<T>
}

/**
 * Queue a successor job. The unique (adventure, stage, chapter) slot is reused across reruns:
 * an existing row (done/failed) is reset to queued rather than duplicated.
 */
export async function enqueueJob(
  db: SupabaseClient,
  adventureId: string,
  stage: number,
  chapterId: string | null = null,
): Promise<void> {
  let query = db.from('guide_jobs').select('id').eq('adventure_id', adventureId).eq('stage', stage)
  query = chapterId === null ? query.is('chapter_id', null) : query.eq('chapter_id', chapterId)
  const { data: existing, error } = await query.maybeSingle()
  assertOk(error, 'job lookup failed')

  if (existing) {
    const { error: updateError } = await db
      .from('guide_jobs')
      .update({ status: 'queued', error: null, started_at: null, finished_at: null })
      .eq('id', existing.id)
    assertOk(updateError, 'job requeue failed')
    return
  }
  const { error: insertError } = await db
    .from('guide_jobs')
    .insert({ adventure_id: adventureId, stage, chapter_id: chapterId })
  assertOk(insertError, 'job insert failed')
}
