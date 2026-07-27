// Deterministic narration + atom audit over every run already recorded. $0, no LLM, no new play.
//
// WHY. Narration work had no definition of done. Every judgement about it - including every one
// made on 2026-07-27 - came from reading a single transcript and forming an opinion: n = 1,
// unfalsifiable, so the defect list had no bottom and "is it better?" had no answer. Meanwhile 67
// runs and ~4800 published lines were sitting on disk unread, already paid for.
//
// Everything here is a CODE check over stored artifacts. No model is asked whether prose is good;
// the checks are structural facts a reader would also call wrong, which is the only kind that can
// be trusted to move a number. Run it before and after a narration change and compare.
//
// Usage: node tests/lab/narration-audit.mjs            (transcripts only)
//        node tests/lab/narration-audit.mjs --atoms    (also queries live atom sources)
import { readdirSync, readFileSync } from 'node:fs'

const LOGS = 'tests/lab/logs'
const FALLBACK = 'The attempt is resolved; the outcome stands.'
/** NARRATOR_BASE asks for "2-4 sentences, vivid but concise". ~400 chars is a generous 4. */
const LENGTH_BRIEF = 400

function loadRuns() {
  return readdirSync(LOGS).filter((f) => f.endsWith('.summary.json')).flatMap((f) => {
    try {
      const s = JSON.parse(readFileSync(`${LOGS}/${f}`, 'utf8'))
      return Array.isArray(s.transcript) && s.transcript.length > 0 ? [{ id: f.slice(0, 8), s }] : []
    } catch { return [] }
  })
}

const sentences = (t) => t.split(/(?<=[.!?])\s+/).filter((x) => x.trim())

/**
 * Proper nouns, meaning capitalised words that are NOT the first word of a sentence.
 *
 * The naive version - every capitalised token - made this metric useless on its first run:
 * "Those/There", "Thank/That", "While/Will" are just sentence openings a letter or two apart, and
 * they buried the handful of real findings under 281 false pairs. A measurement nobody can trust
 * is worse than no measurement, because it still costs attention.
 */
function properNouns(text) {
  const found = []
  for (const s of sentences(text)) {
    const words = s.trim().split(/\s+/).slice(1) // drop the sentence-initial word
    for (const w of words) {
      const clean = w.replace(/[^A-Za-z']/g, '')
      if (/^[A-Z][a-z]{3,}$/.test(clean)) found.push(clean)
    }
  }
  return found
}

/** "Magistrate/Magistrates", "Atheria/Atherian" are inflections of one word, not a misspelling. */
const isInflection = (a, b) => b.startsWith(a) || a.startsWith(b)

/** Levenshtein <= 2 on names of similar length: "Calder" vs "Calver" is drift, not a new person. */
function nearMiss(a, b) {
  if (a === b || Math.abs(a.length - b.length) > 2 || a.length < 5) return false
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) d[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length][b.length] <= 2
}

function auditRun({ s }) {
  const narration = s.transcript.filter((l) => !l.speaker)
  const all = s.transcript
  const chars = narration.reduce((a, l) => a + l.text.length, 0)

  // Name drift: two spellings of what is almost certainly one name, in one run. A misspelt NPC is
  // not cosmetic - NPC references elsewhere match by name, so the wrong spelling is a person who
  // does not exist.
  const names = new Map()
  for (const l of all) for (const n of properNouns(l.text)) names.set(n, (names.get(n) ?? 0) + 1)
  const seen = [...names.keys()]
  const drift = new Set()
  for (let i = 0; i < seen.length; i++) {
    for (let j = i + 1; j < seen.length; j++) {
      const [x, y] = [seen[i].toLowerCase(), seen[j].toLowerCase()]
      if (!isInflection(x, y) && nearMiss(x, y)) drift.add(`${seen[i]}/${seen[j]}`)
    }
  }

  // Near-duplicate narration: the same beat written twice is the shape a stuck loop takes in prose.
  const norm = (t) => t.toLowerCase().replace(/[^a-z ]/g, '').split(/\s+/).slice(0, 12).join(' ')
  const openings = narration.map((l) => norm(l.text))
  const repeats = openings.length - new Set(openings).size

  return {
    lines: narration.length,
    avgChars: narration.length ? Math.round(chars / narration.length) : 0,
    overLong: narration.filter((l) => l.text.length > LENGTH_BRIEF).length,
    avgSentences: narration.length
      ? +(narration.reduce((a, l) => a + sentences(l.text).length, 0) / narration.length).toFixed(1)
      : 0,
    cutOff: all.filter((l) => l.text.trim().length > 150 && !/[.!?"'*)\]]$/.test(l.text.trim())).length,
    fallbacks: all.filter((l) => l.text === FALLBACK).length,
    silent: (s.turns_silent ?? []).length,
    incidents: (s.incidents ?? []).length,
    nameDrift: [...drift],
    repeats,
  }
}

function report(runs) {
  const a = runs.map(auditRun)
  const sum = (k) => a.reduce((x, r) => x + r[k], 0)
  const lines = sum('lines')
  const pct = (n) => `${((n / Math.max(lines, 1)) * 100).toFixed(1)}%`
  console.log(`\n=== narration audit: ${runs.length} runs, ${lines} narration lines ===\n`)
  console.log(`  avg length          ${Math.round(a.reduce((x, r) => x + r.avgChars * r.lines, 0) / Math.max(lines, 1))} chars`)
  console.log(`  avg sentences       ${(a.reduce((x, r) => x + r.avgSentences * r.lines, 0) / Math.max(lines, 1)).toFixed(1)}  (brief asks 2-4)`)
  console.log(`  over ${LENGTH_BRIEF} chars     ${sum('overLong')}  ${pct(sum('overLong'))} of lines`)
  console.log(`  cut off mid-thought ${sum('cutOff')}`)
  console.log(`  mechanical fallback ${sum('fallbacks')}`)
  console.log(`  silent turns        ${sum('silent')}`)
  console.log(`  repeated openings   ${sum('repeats')}  ${pct(sum('repeats'))} of lines`)
  console.log(`  incidents logged    ${sum('incidents')}`)
  const drift = a.flatMap((r) => r.nameDrift)
  console.log(`  name drift          ${drift.length} pair(s) across ${a.filter((r) => r.nameDrift.length).length} run(s)`)
  for (const d of [...new Set(drift)].slice(0, 12)) console.log(`      ${d}`)
}

/** Who actually writes world state: authored maps, or an agent's proposal? */
async function atomSources() {
  const { serviceRest } = await import('./shared.mjs')
  const rows = await serviceRest('GET', 'event_log?type=eq.milestone_reached&select=payload&limit=5000')
  const by = {}
  for (const r of rows) {
    const src = r.payload?.source ?? 'unknown'
    by[src] = (by[src] ?? 0) + 1
  }
  const total = rows.length || 1
  console.log(`\n=== atom writers: ${rows.length} milestones ever applied ===\n`)
  for (const [src, n] of Object.entries(by).sort((x, y) => y[1] - x[1])) {
    console.log(`  ${String(n).padStart(5)}  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${src}`)
  }
  const authored = by.encounter_outcome ?? 0
  console.log(`\n  code-driven (authored maps): ${((authored / total) * 100).toFixed(1)}%`)
  console.log(`  agent-proposed             : ${(((total - authored) / total) * 100).toFixed(1)}%`)
}

const runs = loadRuns()
report(runs)
if (process.argv.includes('--atoms')) await atomSources()
