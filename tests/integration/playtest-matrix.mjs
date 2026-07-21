/**
 * Runs several playtest premises CONCURRENTLY and prints one comparison table.
 *
 * Sequentially, a seven-genre sweep is seven guide generations plus seven 26-turn sessions, and
 * almost all of that time is spent waiting on someone else's network. Each run builds its own
 * user, its own adventure and its own model pin, so they share nothing and can overlap freely.
 *
 * Concurrency is capped because the far side is not free: OpenRouter rate-limits per key, and a
 * burst of parallel sessions competes with itself for the same edge-function capacity. 3 is a
 * deliberate default - enough to cut a sweep to a third, low enough that a 429 storm does not
 * become the thing under test.
 *
 *   node tests/integration/playtest-matrix.mjs --plots court,plague,escort --budget 0.25
 *   node tests/integration/playtest-matrix.mjs --plots all --concurrency 3 --turns 12
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'

const argOf = (name, fallback) => {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`))
  if (!hit) return fallback
  if (hit.includes('=')) return hit.split('=').slice(1).join('=')
  return process.argv[process.argv.indexOf(hit) + 1] ?? fallback
}

const ALL = ['murder', 'heist', 'siege', 'dungeon', 'escort', 'expedition', 'court', 'horror', 'plague']
const plotsArg = argOf('plots', 'all')
const plots = plotsArg === 'all' ? ALL : plotsArg.split(',').map((p) => p.trim()).filter(Boolean)
const concurrency = Math.max(1, Number(argOf('concurrency', '3')))
const budget = argOf('budget', '0.25')
const turns = argOf('turns', '')
const type = argOf('type', 'one_shot')
const outDir = argOf('out', 'tests/integration/.playtest-logs')

mkdirSync(outDir, { recursive: true })

/**
 * --reuse skips regeneration by remembering the adventure each premise generated. Only sound
 * when the change under test is in PLAY (the archivist, the ledger, adjudication); a change to
 * the guide pipeline needs a fresh guide, so this is opt-in rather than the default.
 */
const reuse = process.argv.includes('--reuse')
const cachePath = `${outDir}/adventures.json`
const cache = reuse && existsSync(cachePath) ? JSON.parse(readFileSync(cachePath, 'utf8')) : {}

/**
 * Surfaced the moment they are printed rather than after the sweep. A parallel sweep hides
 * failures inside per-plot logs nobody reads until the end, which is how three turns of
 * "Adjudicator output invalid" sat unnoticed across two runs.
 */
const PROBLEMS = [
  /PLAYTEST ERROR/i,
  /\(5\d\d\)/,                       // 5xx on a turn
  /output invalid/i,
  /failed \d+x|stage \d+ failed/i,
  /double.failure/i,
  /mechanical fallback lines:\s+[1-9]/,
  /turns that errored:\s+[1-9]/,
  /COULD NOT be trimmed/,
  /STILL over/,
  /budget guard/,
]

const run = (plot) =>
  new Promise((resolve) => {
    const logPath = `${outDir}/${plot}.log`
    const advId = cache[plot]
    const args = [
      'tests/integration/multichapter-playtest.mjs',
      '--type', type, '--plot', plot, '--budget', budget,
      ...(turns ? ['--turns', turns] : []),
      ...(reuse ? ['--keep'] : []),
      ...(reuse && advId ? ['--adventure', advId] : []),
    ]
    const started = Date.now()
    const child = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    const chunks = []
    const issues = []
    let pending = ''
    const scan = (d) => {
      chunks.push(d)
      pending += d.toString()
      const lines = pending.split('\n')
      pending = lines.pop() ?? ''
      for (const raw of lines) {
        const clean = raw.trim()
        if (!clean) continue
        if (PROBLEMS.some((re) => re.test(clean))) {
          issues.push(clean)
          console.log(`  !! [${plot}] ${clean.slice(0, 160)}`)
        }
        const kept = clean.match(/kept for reuse: --adventure (\S+)/)
        if (kept) cache[plot] = kept[1]
      }
    }
    child.stdout.on('data', scan)
    child.stderr.on('data', scan)
    child.on('close', (code) => {
      writeFileSync(logPath, Buffer.concat(chunks).toString())
      const secs = ((Date.now() - started) / 1000).toFixed(0)
      const tag = code === 0 ? 'done' : `FAILED(${code})`
      console.log(`  ${tag}  ${plot.padEnd(11)} ${secs}s${advId ? ' (reused guide)' : ''}  -> ${logPath}`)
      resolve({ plot, code, logPath, issues })
    })
  })

/** Pull the numbers that decide whether a run progressed the story. */
function summarize(logPath) {
  let text = ''
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return null
  }
  const grab = (re, fallback = '-') => (text.match(re)?.[1] ?? fallback).trim()
  const ledger = text.match(/scene ledgers: \d+ \(milestones proposed (\d+), applied (\d+)\)/)
  return {
    objectives: grab(/objectives completed:\s+(\d+)/),
    proposed: ledger?.[1] ?? '-',
    applied: ledger?.[2] ?? '-',
    beats: grab(/beats opened \/ exits met:\s+(\S+)/),
    travel: grab(/scene_travel events: (\d+)/),
    clues: grab(/location clues found:\s+(\d+ of \d+)/),
    fallbacks: grab(/mechanical fallback lines:\s+(\d+)/),
    errored: grab(/turns that errored:\s+(\d+)/),
    spend: grab(/TOTAL: \$([0-9.]+)/),
    secs: grab(/play took (\d+)s/),
  }
}

const started = Date.now()
console.log(`running ${plots.length} premises, ${concurrency} at a time\n`)

const queue = [...plots]
const results = []
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) results.push(await run(queue.shift()))
  }),
)

const rows = results
  .sort((a, b) => plots.indexOf(a.plot) - plots.indexOf(b.plot))
  .map((r) => ({ plot: r.plot, ...(summarize(r.logPath) ?? {}) }))

const cols = ['plot', 'objectives', 'proposed', 'applied', 'beats', 'travel', 'clues', 'fallbacks', 'errored', 'spend', 'secs']
const width = (c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '-').length))
const line = (cells) => '  ' + cols.map((c, i) => String(cells[i]).padEnd(width(c))).join('  ')
console.log(`\n${line(cols)}`)
console.log('  ' + cols.map((c) => '-'.repeat(width(c))).join('  '))
rows.forEach((r) => console.log(line(cols.map((c) => r[c] ?? '-'))))

const withIssues = results.filter((r) => r.issues.length > 0)
if (withIssues.length > 0) {
  console.log(`\n[issues] ${withIssues.reduce((n, r) => n + r.issues.length, 0)} across ${withIssues.length} of ${results.length} runs`)
  for (const r of withIssues) {
    console.log(`  ${r.plot}:`)
    // Identical lines repeat per turn; the count is the signal, the text only needs saying once.
    const seen = new Map()
    r.issues.forEach((i) => seen.set(i, (seen.get(i) ?? 0) + 1))
    ;[...seen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .forEach(([text, n]) => console.log(`    ${n > 1 ? `x${n} ` : ''}${text.slice(0, 150)}`))
  }
} else {
  console.log('\n[issues] none')
}

if (reuse) {
  writeFileSync(cachePath, JSON.stringify(cache, null, 2))
  console.log(`\nguides cached in ${cachePath} - delete it to force regeneration`)
}

const total = rows.reduce((sum, r) => sum + (Number(r.spend) || 0), 0)
console.log(`\nwall clock ${((Date.now() - started) / 1000 / 60).toFixed(1)} min, play spend $${total.toFixed(4)} across ${rows.length} runs`)
if (results.some((r) => r.code !== 0)) process.exitCode = 1
