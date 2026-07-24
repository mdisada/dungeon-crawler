// Dual logger for lab runs: every entry goes to the run's JSONL file (the durable artifact
// Claude analyzes) AND to lab_run_events (what the /adventure-lab page live-tails). Console
// output stays human-skimmable for the terminal running the watcher.
import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

import { serviceRest } from './shared.mjs'

export function createRunLogger(runId, logPath) {
  mkdirSync(dirname(logPath), { recursive: true })

  // DB writes are fire-and-forget in sequence: the page tolerates a short lag, but a run must
  // never die because a log insert hiccuped. Failures are printed, not thrown.
  let chain = Promise.resolve()

  const log = (phase, fn, label = '', detail = {}, durationMs = null) => {
    const entry = {
      ts: new Date().toISOString(),
      phase, fn, label, detail,
      ...(durationMs !== null ? { duration_ms: Math.round(durationMs) } : {}),
    }
    appendFileSync(logPath, JSON.stringify(entry) + '\n')
    console.log(`  [${phase}] ${fn}${label ? ` ${label}` : ''}${durationMs !== null ? ` (${Math.round(durationMs)}ms)` : ''}`)
    chain = chain
      .then(() => serviceRest('POST', 'lab_run_events', {
        run_id: runId, phase, fn, label: label.slice(0, 300), detail,
        duration_ms: durationMs !== null ? Math.round(durationMs) : null,
      }))
      .catch((err) => console.error(`  !! lab_run_events insert failed: ${err.message}`))
    return entry
  }

  /** Times an async step and logs it with its duration; rethrows after logging failures. */
  const timed = async (phase, fn, label, work, detail = {}) => {
    const started = Date.now()
    try {
      const result = await work()
      log(phase, fn, label, { ...detail, ...(result?.logDetail ?? {}) }, Date.now() - started)
      return result
    } catch (err) {
      log(phase, fn, `${label} FAILED`, { ...detail, error: String(err?.message ?? err) }, Date.now() - started)
      throw err
    }
  }

  /** Awaited on shutdown so the tail of the stream lands before the run flips to done. */
  const flush = () => chain

  return { log, timed, flush }
}
