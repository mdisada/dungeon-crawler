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
 *   node tests/integration/playtest-matrix.mjs --plots court,plague,escort,horror --repeat 3
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
// One run can't tell a fix from luck on the noisy metrics (objectives swung 0->2->0->1 on
// unchanged code). --repeat N plays each genre N times and reports median + range, so a change
// is judged against a distribution instead of a single sample.
const repeat = Math.max(1, Number(argOf('repeat', '1')))

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
  /could not be rebalanced/i,
  /budget guard/,
]

const run = ({ plot, rep }) =>
  new Promise((resolve) => {
    const label = repeat > 1 ? `${plot} r${rep + 1}` : plot
    const logPath = `${outDir}/${plot}${repeat > 1 ? `.r${rep + 1}` : ''}.log`
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
          console.log(`  !! [${label}] ${clean.slice(0, 160)}`)
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
      console.log(`  ${tag}  ${label.padEnd(14)} ${secs}s${advId ? ' (reused guide)' : ''}  -> ${logPath}`)
      resolve({ plot, rep, code, logPath, issues })
    })
  })

/**
 * Pull the raw per-run numbers as NUMBERS so a set of runs can be aggregated (median + range).
 * Fields split apart from their display strings on purpose: "beats opened / exits met 5/3" is two
 * independent signals, and beat throughput (opened) is exactly what 1.1 will be judged on.
 */
function summarize(logPath) {
  let text = ''
  try {
    text = readFileSync(logPath, 'utf8')
  } catch {
    return null
  }
  // A run that died before play (setup failure, guide never ready) has no numbers to offer -
  // treating its log as all-zeros dragged court's medians to the floor (live 2026-07-22). The
  // failure stays visible: the [stable signals] gen column counts every launched run.
  if (!/play took \d+s/.test(text)) return null
  const num = (re, fallback = 0) => {
    const m = text.match(re)
    return m ? Number(m[1]) : fallback
  }
  const ledger = text.match(/milestones proposed (\d+), applied (\d+)\)/)
  const beats = text.match(/beats opened \/ exits met:\s+(\d+)\/(\d+)/)
  const clues = text.match(/location clues found:\s+(\d+) of (\d+)/)
  const checks = text.match(/checks prompted\/rolled:\s+(\d+)\/(\d+)/)
  const entryMap = (() => {
    const m = text.match(/entry mapping:\s+(\{.*?\})/)
    if (!m) return {}
    try { return JSON.parse(m[1]) } catch { return {} }
  })()
  // A run that reached guide_ready and never threw is a generation success - the first stable
  // signal (trusted even at n=1). A truncated/failed generation shows one of these instead.
  const genOk = /guide status: guide_ready/.test(text) && !/PLAYTEST ERROR|guide never became ready/.test(text)
  return {
    genOk,
    turns: num(/turns played:\s+(\d+)/),
    objectives: num(/objectives completed:\s+(\d+)/),
    proposed: ledger ? Number(ledger[1]) : 0,
    applied: ledger ? Number(ledger[2]) : 0,
    beatsOpened: beats ? Number(beats[1]) : 0,
    beatsExits: beats ? Number(beats[2]) : 0,
    travel: num(/scene_travel events: (\d+)/),
    cluesFound: clues ? Number(clues[1]) : 0,
    checksRolled: checks ? Number(checks[2]) : 0,
    // fold_in = input absorbed into narration with no check/choice/encounter: the closest proxy
    // for "the player did not get to act". A high-fold session is narration with dice sprinkled on.
    folds: Number(entryMap.fold_in) || 0,
    fallbacks: num(/mechanical fallback lines:\s+(\d+)/),
    errored: num(/turns that errored:\s+(\d+)/),
    doubleFail: num(/consistency double-failures:\s+(\d+)/),
    rejected: num(/milestone claims REJECTED:\s+(\d+)/),
    // Recognition judge: fired = how often it ran (beat resolutions with an incomplete
    // objective); recogYes = completed-verdicts (in shadow these credit nothing yet).
    recogFired: num(/objective_recognized:\s+(\d+)/),
    recogYes: num(/objective_recognized:\s+\d+ \(completed-verdicts (\d+)\)/),
    spend: Number(text.match(/TOTAL: \$([0-9.]+)/)?.[1] ?? 0),
    secs: num(/play took (\d+)s/),
  }
}

const started = Date.now()
const tasks = plots.flatMap((plot) => Array.from({ length: repeat }, (_, rep) => ({ plot, rep })))
console.log(`running ${plots.length} premises x ${repeat} = ${tasks.length} runs, ${concurrency} at a time\n`)

const queue = [...tasks]
const results = []
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, async () => {
    while (queue.length > 0) results.push(await run(queue.shift()))
  }),
)

// One summarized row per completed run, grouped back under its plot for aggregation.
const byPlot = new Map(plots.map((p) => [p, []]))
for (const r of results) byPlot.get(r.plot)?.push({ ...r, s: summarize(r.logPath) })
const runsOf = (plot) => (byPlot.get(plot) ?? []).filter((r) => r.s)

const median = (xs) => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}
const fmt = (n, digits) => (digits ? n.toFixed(digits) : Number.isInteger(n) ? String(n) : n.toFixed(1))
// median, with [min-max] appended only when the runs actually disagreed - the range IS the point
// of --repeat, but printing "[2-2]" in every cell is noise.
const cell = (xs, digits = 0) => {
  if (xs.length === 0) return '-'
  const lo = Math.min(...xs)
  const hi = Math.max(...xs)
  return lo === hi ? fmt(median(xs), digits) : `${fmt(median(xs), digits)} [${fmt(lo, digits)}-${fmt(hi, digits)}]`
}
const perTurn = (r, key) => (r.s && r.s.turns > 0 ? r.s[key] / r.s.turns : 0)

function table(title, columns, rowFor) {
  const header = ['plot', ...columns.map((c) => c.label)]
  const cells = plots.map((plot) => [plot, ...rowFor(plot)])
  const width = (i) => Math.max(header[i].length, ...cells.map((row) => String(row[i]).length))
  const fmtRow = (row) => '  ' + row.map((v, i) => String(v).padEnd(width(i))).join('  ')
  console.log(`\n${title}`)
  console.log(fmtRow(header))
  console.log('  ' + header.map((_, i) => '-'.repeat(width(i))).join('  '))
  cells.forEach((row) => console.log(fmtRow(row)))
}

// prog/turn (applied milestones per turn) makes one_shot and multi_chapter comparable: 26 turns
// only samples the opening of a 3-chapter adventure, so the ABSOLUTE objective count understates
// it (0.3). foldRate and checks/turn are the player-agency pacing signals (0.4): a high-fold, low-
// check session is narration the player barely got to touch.
const metrics = [
  { label: 'obj', digits: 0, get: (r) => r.s.objectives },
  { label: 'applied', digits: 0, get: (r) => r.s.applied },
  { label: 'prop', digits: 0, get: (r) => r.s.proposed },
  { label: 'prog/t', digits: 2, get: (r) => perTurn(r, 'applied') },
  { label: 'bOpen', digits: 0, get: (r) => r.s.beatsOpened },
  { label: 'bExit', digits: 0, get: (r) => r.s.beatsExits },
  { label: 'foldR', digits: 2, get: (r) => perTurn(r, 'folds') },
  { label: 'chk/t', digits: 2, get: (r) => perTurn(r, 'checksRolled') },
  { label: 'recog', digits: 0, get: (r) => r.s.recogYes },
  { label: 'travel', digits: 0, get: (r) => r.s.travel },
  { label: 'clues', digits: 0, get: (r) => r.s.cluesFound },
  { label: 'spend', digits: 4, get: (r) => r.s.spend },
  { label: 'secs', digits: 0, get: (r) => r.s.secs },
]
table(
  `[progress + pacing] median${repeat > 1 ? ' [min-max]' : ''} over ${repeat} run(s) per plot`,
  metrics,
  (plot) => metrics.map((m) => cell(runsOf(plot).map(m.get), m.digits)),
)

// Stable signals: low variance all session, so a non-zero here is a real defect, not the sampling
// noise an objective swing is. gen = runs that reached guide_ready and did not throw.
const stable = [
  { label: 'fallbk', get: (r) => r.s.fallbacks },
  { label: 'errored', get: (r) => r.s.errored },
  { label: 'dblFail', get: (r) => r.s.doubleFail },
  { label: 'rejected', get: (r) => r.s.rejected },
]
table('[stable signals] trusted even in a single run', [{ label: 'gen' }, ...stable], (plot) => {
  const all = byPlot.get(plot) ?? []
  const genOk = all.filter((r) => r.s?.genOk && r.code === 0).length
  return [`${genOk}/${all.length}`, ...stable.map((m) => cell(runsOf(plot).map(m.get), 0))]
})

// The one metric that swung on unchanged code all session - never read a single value here as a
// result (retracted twice this session); the spread is the honest picture.
console.log('\n[noisy - objectives completed, raw per run]')
plots.forEach((plot) => {
  const vals = runsOf(plot).map((r) => r.s.objectives)
  console.log(vals.length === 0 ? `  ${plot}: no completed runs` : `  ${plot}: ${vals.join('/')} (median ${fmt(median(vals), 0)})`)
})

const withIssues = results.filter((r) => r.issues.length > 0)
if (withIssues.length > 0) {
  console.log(`\n[issues] ${withIssues.reduce((n, r) => n + r.issues.length, 0)} across ${withIssues.length} of ${results.length} runs`)
  for (const r of withIssues) {
    console.log(`  ${repeat > 1 ? `${r.plot} r${r.rep + 1}` : r.plot}:`)
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

const total = [...byPlot.values()].flat().reduce((sum, r) => sum + (r.s?.spend ?? 0), 0)
console.log(`\nwall clock ${((Date.now() - started) / 1000 / 60).toFixed(1)} min, play spend $${total.toFixed(4)} across ${results.length} runs`)
if (results.some((r) => r.code !== 0)) process.exitCode = 1
