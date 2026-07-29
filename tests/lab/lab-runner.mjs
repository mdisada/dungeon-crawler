// Adventure Lab watcher: polls lab_runs for queued work and executes runs ONE AT A TIME so
// each playthrough can be evaluated on its own (and never competes with itself for edge
// capacity or the OpenRouter key). Start it once next to the dev server:
//
//   node tests/lab/lab-runner.mjs            # watch mode (the /adventure-lab button works)
//   node tests/lab/lab-runner.mjs --once     # drain the queue, then exit
//   node tests/lab/lab-runner.mjs --run <id> # execute one specific run, then exit
//
// PAID: every run spends real OpenRouter credits, bounded per run by config.budget_usd.
import { executeRun } from './run-playthrough.mjs'
import { describeError, serviceRest, sleep } from './shared.mjs'

const POLL_MS = 3000

/**
 * A run may hold `running` this long before the queue stops believing it (2026-07-29).
 *
 * `status` is only ever written by executeRun's own try/catch, so a runner killed OUTRIGHT - the
 * terminal closed, the laptop slept, Ctrl-C - never reaches it and the row says `running` forever.
 * Because claimNext refuses to claim past any running row, one such death wedges the whole queue
 * silently: run 89155982 died 96 seconds in on 2026-07-26 and nothing could be claimed for the
 * next 69 hours. Every watcher started in that window polled forever and picked up nothing.
 *
 * This is the same failure the table already fixed one layer down (TYPING_STALE_MS in
 * _shared/play/liveness.ts): a worker killed mid-call leaves a flag raised and nothing can lower
 * it. The margin is generous for the same reason it is there - clearing early would let a second
 * runner start beside a live one, and two runs competing for edge capacity and the OpenRouter key
 * is strictly worse than a stalled queue.
 */
const STALE_RUN_MS = 30 * 60_000

/**
 * ...but age alone cannot tell a dead run from a long one, and long runs are legitimate: a
 * 100-turn playthrough outlives any threshold worth setting. So age only opens the question, and
 * the run's own log answers it.
 *
 * `lab_run_events` is a real heartbeat here, unlike the event-log silence rule liveness.ts had to
 * abandon. That rule was refreshable by ANY background writer, so a dead turn looked alive.
 * Nothing but the runner ever writes lab_run_events for its own run_id - the orphan wrote 59 rows
 * in its 96 seconds - so silence on that stream means the writer is gone, and nothing else can
 * forge it.
 */
const HEARTBEAT_SILENCE_MS = 10 * 60_000

/**
 * Mark runs that cannot still be alive as failed, so the queue moves. Best-effort: a sweep that
 * throws must never stop the watcher from doing its actual job.
 */
async function reapDeadRuns(running) {
  for (const row of running) {
    const startedAt = Date.parse(row.started_at ?? row.created_at)
    if (!Number.isFinite(startedAt) || Date.now() - startedAt < STALE_RUN_MS) continue
    const [beat] = await serviceRest(
      'GET', `lab_run_events?run_id=eq.${row.id}&select=created_at&order=id.desc&limit=1`)
    const lastWrite = Date.parse(beat?.created_at ?? row.started_at ?? row.created_at)
    if (Number.isFinite(lastWrite) && Date.now() - lastWrite < HEARTBEAT_SILENCE_MS) continue
    const quietMin = Math.round((Date.now() - lastWrite) / 60_000)
    console.error(`reaping orphaned run ${row.id} - no log line for ${quietMin}min`)
    await serviceRest('PATCH', `lab_runs?id=eq.${row.id}`, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error: `runner died mid-run: no log line for ${quietMin}min (reaped by the queue)`,
    })
  }
}

async function claimNext() {
  // Serial by design: never claim while anything is running (e.g. a second watcher's run).
  const running = await serviceRest('GET', 'lab_runs?status=eq.running&select=id,started_at,created_at')
  if (running.length > 0) {
    await reapDeadRuns(running).catch((err) => console.error(`reap failed: ${err?.message ?? err}`))
    const still = await serviceRest('GET', 'lab_runs?status=eq.running&select=id&limit=1')
    if (still.length > 0) return null
  }
  const [next] = await serviceRest('GET', 'lab_runs?status=eq.queued&select=*&order=created_at&limit=1')
  return next ?? null
}

async function execute(run) {
  console.log(`\n=== run ${run.id} ===`)
  console.log(`config: ${JSON.stringify(run.config)}`)
  const started = Date.now()
  try {
    const summary = await executeRun(run)
    console.log(`=== done in ${((Date.now() - started) / 60000).toFixed(1)}min - $${summary.spend.total_usd.toFixed(4)} ===`)
  } catch (err) {
    console.error(`=== FAILED: ${describeError(err)} ===`)
  }
}

async function main() {
  const runIdx = process.argv.indexOf('--run')
  if (runIdx !== -1) {
    const id = process.argv[runIdx + 1]
    const [run] = await serviceRest('GET', `lab_runs?id=eq.${id}&select=*`)
    if (!run) throw new Error(`no lab_runs row with id ${id}`)
    await execute(run)
    return
  }

  const once = process.argv.includes('--once')
  console.log(`lab runner ${once ? 'draining queue' : 'watching'} (poll every ${POLL_MS / 1000}s, one run at a time)`)
  for (;;) {
    let run = null
    try {
      run = await claimNext()
    } catch (err) {
      console.error(`poll failed: ${err?.message ?? err}`)
    }
    if (run) await execute(run)
    else if (once) break
    else await sleep(POLL_MS)
  }
}

main().catch((err) => {
  console.error('lab runner crashed:', err?.message ?? err)
  process.exitCode = 1
})
