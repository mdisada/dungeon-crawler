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
import { serviceRest, sleep } from './shared.mjs'

const POLL_MS = 3000

async function claimNext() {
  // Serial by design: never claim while anything is running (e.g. a second watcher's run).
  const running = await serviceRest('GET', 'lab_runs?status=eq.running&select=id&limit=1')
  if (running.length > 0) return null
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
    console.error(`=== FAILED: ${err?.message ?? err} ===`)
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
