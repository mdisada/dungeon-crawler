// Job runner: picks the next queued job for an adventure, executes its stage, and reports
// whether a follow-up kick is needed. One job per invocation keeps every run well inside the
// edge runtime's wall clock; failures pause the queue (F04 SS2) until the user retries.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { AgentCallError, callAgentText } from '../_shared/llm.ts'
import type { ParseResult } from '../_shared/guide/types.ts'
import type { StageEnv, StagePrompt } from './stage-env.ts'
import { runStage1, runStage2, runStage3 } from './stages-story.ts'
import { runStage4, runStage5 } from './stages-content.ts'
import { runStage6, runStage7 } from './stages-weave.ts'
import { runStage8 } from './stages-endings.ts'
import { assertOk, type AdventureRow } from './util.ts'

// An invocation can't outlive the edge runtime's wall clock (150s on the free tier - verified
// the hard way in the Phase 3b live smoke test), so anything "running" past this is a corpse.
const STALE_RUNNING_MS = 4 * 60 * 1000
// Total tries per job before the queue pauses for a manual retry: the in-invocation validation
// retry is skipped when the first call already burned the wall-clock budget, so transient
// failures get a fresh invocation (fresh 150s) instead.
const MAX_ATTEMPTS = 3
// Past this much elapsed invocation time, don't start a second LLM call - fail fast and let the
// requeue give it a fresh invocation.
const FEEDBACK_RETRY_BUDGET_MS = 45 * 1000

export type RunResult = 'ran' | 'busy' | 'idle' | 'failed'

export async function processNextJob(
  db: SupabaseClient,
  openRouterApiKey: string,
  adventureId: string,
): Promise<RunResult> {
  const { data: jobs, error } = await db
    .from('guide_jobs')
    .select('id, stage, chapter_id, status, attempts, started_at, error')
    .eq('adventure_id', adventureId)
    .in('status', ['queued', 'running'])
    .order('stage')
    .order('created_at')
  assertOk(error, 'jobs load failed')

  const running = (jobs ?? []).find((j) => j.status === 'running')
  if (running) {
    const startedAt = running.started_at ? Date.parse(running.started_at) : 0
    if (Date.now() - startedAt < STALE_RUNNING_MS) return 'busy'
    // The invocation died (wall clock kill) - requeue for a fresh try, or pause when exhausted.
    const requeue = running.attempts < MAX_ATTEMPTS
    const { error: staleError } = await db
      .from('guide_jobs')
      .update(
        requeue
          ? { status: 'queued', started_at: null }
          : { status: 'failed', error: 'The runner was killed before finishing (edge wall-clock limit). Retry to re-run this stage.', finished_at: new Date().toISOString() },
      )
      .eq('id', running.id)
      .eq('status', 'running')
    assertOk(staleError, 'stale job cleanup failed')
    return requeue ? 'ran' : 'failed'
  }

  const job = (jobs ?? []).find((j) => j.status === 'queued')
  if (!job) return 'idle'
  // Captured before the claim clears it - the prior attempt's validator errors, if any.
  const priorError: string | null = job.attempts > 0 ? (job.error ?? null) : null

  // Optimistic claim - a competing invocation loses the status filter race and does nothing.
  const { data: claimed, error: claimError } = await db
    .from('guide_jobs')
    .update({ status: 'running', started_at: new Date().toISOString(), attempts: job.attempts + 1, error: null })
    .eq('id', job.id)
    .eq('status', 'queued')
    .select('id')
  assertOk(claimError, 'job claim failed')
  if ((claimed ?? []).length === 0) return 'busy'

  const { data: adventure, error: adventureError } = await db
    .from('adventures')
    .select('id, creator_id, plot_idea, mode, type, chapters_min, chapters_max, min_players, max_players, difficulty_setting, meta_loop, status')
    .eq('id', adventureId)
    .single()
  assertOk(adventureError, 'adventure load failed')

  const env: StageEnv = {
    db,
    adventure: adventure as AdventureRow,
    currentJobId: job.id,
    priorError,
    generate: (agentRole, prompt, parse) =>
      generateParsed(db, openRouterApiKey, adventure as AdventureRow, agentRole, prompt, parse, priorError),
  }

  try {
    await runStage(env, job.stage, job.chapter_id)
    const { error: doneError } = await db
      .from('guide_jobs')
      .update({ status: 'done', finished_at: new Date().toISOString() })
      .eq('id', job.id)
    assertOk(doneError, 'job completion failed')
    return 'ran'
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`guide-pipeline stage ${job.stage} failed (attempt ${job.attempts + 1})`, message)
    // First failure gets an automatic fresh-invocation retry; after that the queue pauses with
    // the error surfaced on the job row (F04 SS2 failure handling).
    const requeue = job.attempts + 1 < MAX_ATTEMPTS
    await db
      .from('guide_jobs')
      .update(
        requeue
          ? { status: 'queued', error: message.slice(0, 2000), started_at: null }
          : { status: 'failed', error: message.slice(0, 2000), finished_at: new Date().toISOString() },
      )
      .eq('id', job.id)
    return requeue ? 'ran' : 'failed'
  }
}

function runStage(env: StageEnv, stage: number, chapterId: string | null): Promise<void> {
  if (stage === 1) return runStage1(env)
  if (stage === 6) return runStage6(env)
  if (stage === 7) return runStage7(env)
  if (stage === 8) return runStage8(env)
  if (!chapterId) throw new Error(`stage ${stage} requires a chapter_id`)
  if (stage === 2) return runStage2(env, chapterId)
  if (stage === 3) return runStage3(env, chapterId)
  if (stage === 4) return runStage4(env, chapterId)
  if (stage === 5) return runStage5(env, chapterId)
  throw new Error(`unknown stage ${stage}`)
}

/** LLM call + parse, with one retry that feeds the validator's complaints back to the model. */
export async function generateParsed<T>(
  db: SupabaseClient,
  openRouterApiKey: string,
  adventure: AdventureRow,
  agentRole: string,
  prompt: StagePrompt,
  parse: (raw: string) => ParseResult<T>,
  priorError: string | null = null,
): Promise<T> {
  const call = (user: string) =>
    callAgentText({
      serviceClient: db,
      openRouterApiKey,
      userId: adventure.creator_id,
      adventureId: adventure.id,
      agentRole,
      system: prompt.system,
      user,
      maxTokens: prompt.maxTokens,
    })

  const invocationStart = Date.now()
  // A cold re-run after a validation failure carries the prior errors into the first call, so the
  // fresh invocation doesn't just repeat the same mistake (the in-invocation retry it lost).
  const firstUser = priorError
    ? `${prompt.user}\n\nYour previous attempt was rejected by the schema validator:\n${priorError.slice(0, 1500)}\n\nFix exactly these problems. Respond with ONLY the corrected JSON object.`
    : prompt.user
  const first = await call(firstUser)
  const parsed = parse(first)
  if (parsed.ok) return parsed.data

  // No wall-clock budget left for a second call in THIS invocation - fail now so the runner's
  // requeue gives the retry a fresh invocation instead of getting killed mid-call.
  if (Date.now() - invocationStart > FEEDBACK_RETRY_BUDGET_MS) {
    throw new AgentCallError(`stage output failed validation (no time budget for an in-invocation retry): ${parsed.errors.slice(0, 8).join('; ')}`)
  }

  const feedback = `${prompt.user}

Your previous response was rejected by the schema validator:
${parsed.errors.slice(0, 12).join('\n')}

Previous response (for reference):
${first.slice(0, 6000)}

Respond again with ONLY the corrected JSON object.`
  const second = await call(feedback)
  const reparsed = parse(second)
  if (reparsed.ok) return reparsed.data
  throw new AgentCallError(`stage output failed validation after retry: ${reparsed.errors.slice(0, 8).join('; ')}`)
}
