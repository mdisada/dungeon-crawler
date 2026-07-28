// Continuity instrument: does the narration contradict itself about where the party is?
// Offline over runs already recorded - no deploy, no play, ~$0.01 per run to execute.
//
// WHY. Every coherence detector in the app was silent: runConsistency short-circuits on an empty
// `restrictions` list (0 objections in ~290 published lines) and the Archivist's contradiction
// audit inherits the "when in doubt return empty" rule written for its state-WRITING fields
// (0 reports in 12 runs). With no instrument, "is the story coherent?" had no answer, and four
// separate sequencing findings made by eye turned out to be measurement artifacts.
//
// SHAPE. Follows the one guard in this codebase that survived production (claimGuard): the MODEL
// PERCEIVES, CODE JUDGES. The model is never asked "is this a contradiction" - the question that
// made runConsistency wrong 14 times out of 14. It is asked only to QUOTE where the players are
// standing in each passage. Everything downstream of that is code.
//
// Two things this got wrong first, both worth keeping in mind before changing it:
//   1. A one-word verdict ("SAME/DIFFERENT") missed BOTH known contradictions - the model anchored
//      on shared entities (Jenric and a cellar appear in both halves of one pair, Edren in both
//      halves of the other) instead of on the party's position. Quoting the evidence fixed it.
//   2. "Different place + no movement event" is NOT a contradiction. Narration legitimately walks
//      the party across a scene - "you wade toward the stairs" -> "Maren hauls you onto her skiff"
//      - and emits no event for it. That is progression, and the second line knew what the first
//      said. CONCURRENCY is what makes a difference a contradiction: a narration takes 9-33s to
//      generate, so a line published within CONCURRENT_S of the previous one was drafted before
//      that one existed and cannot be continuing from it.
//
// LIMITS. Location only - nothing here sees NPC state, causality, or a motive reversing. It
// abstains heavily (~38% indeterminate), so the rate it reports is a LOWER BOUND. The threshold
// and the NONE rule were derived from two hand-verified examples; widen that set before trusting
// the absolute number rather than the direction it moves.
//
// Usage: node tests/lab/continuity-probe.mjs                 (last 3 runs)
//        node tests/lab/continuity-probe.mjs all 10          (last 10 runs)
//        node tests/lab/continuity-probe.mjs <adventure_id>  (one adventure)
import { env, serviceRest } from './shared.mjs'

const MODEL = 'google/gemini-2.5-flash-lite'
const LIMIT = Number(process.argv[3] ?? 3)
const ONLY = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2] : null
/** Below this gap the second line was drafted before the first was published - see header. */
const CONCURRENT_S = 8
/** A location change here is authored, not drift. */
const MOVES = new Set(['scene_travel', 'location_allocated'])

const SYSTEM =
  'You track where the PLAYER CHARACTERS are physically standing across two passages of one ' +
  'tabletop RPG transcript. The player characters are addressed as "you" or by name.\n' +
  'Reply in exactly three lines:\n' +
  'P1: <quote the words showing where the PLAYERS are standing, or NONE>\n' +
  'P2: <quote the words showing where the PLAYERS are standing, or NONE>\n' +
  'VERDICT: SAME | DIFFERENT | INDETERMINATE\n' +
  'SAME - the players stand in the same physical place in both.\n' +
  'DIFFERENT - the players stand somewhere physically different.\n' +
  'INDETERMINATE - either quote is NONE.\n' +
  'A place the passage merely MENTIONS, or where another character is, is NOT where the players ' +
  'are. A shared character or subject between the passages means nothing - two passages can ' +
  'discuss the same person from different rooms. Quote only words about the PLAYERS position.'

async function ask(a, b) {
  let res
  try {
    res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.openRouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 220,
        temperature: 0,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `PASSAGE 1:\n${a}\n\nPASSAGE 2:\n${b}` },
        ],
      }),
    })
  } catch {
    return { verdict: 'ERROR', why: '' }
  }
  if (!res.ok) return { verdict: 'ERROR', why: '' }
  const json = await res.json()
  const text = String(json.choices?.[0]?.message?.content ?? '').trim()
  let verdict = (text.match(/VERDICT:\s*(SAME|DIFFERENT|INDETERMINATE)/i)?.[1] ?? 'ERROR').toUpperCase()
  // CODE JUDGES. Live, the model replied "P1: NONE ... VERDICT: DIFFERENT" - disobeying its own
  // output contract. The quotes are the observation; the verdict is derived here from them.
  const quote = (n) => (text.match(new RegExp(`P${n}:\\s*(.+)`, 'i'))?.[1] ?? '').trim()
  if (/^none\b/i.test(quote(1)) || /^none\b/i.test(quote(2)) || !quote(1) || !quote(2)) {
    verdict = 'INDETERMINATE'
  }
  return { verdict, why: text.replace(/\s*\n\s*/g, ' | ').slice(0, 240) }
}

const runs = ONLY
  ? [{ adventure_id: ONLY }]
  : await serviceRest('GET', `lab_runs?select=adventure_id&adventure_id=not.is.null&order=created_at.desc&limit=${LIMIT}`)

const tally = { pairs: 0, same: 0, indeterminate: 0, moved: 0, progressed: 0, contradictions: 0 }
for (const run of runs) {
  const ev = await serviceRest(
    'GET',
    `event_log?adventure_id=eq.${run.adventure_id}&select=id,type,payload,created_at&order=id`,
  )
  const narration = ev.flatMap((e, i) => (e.type === 'narration_published' ? [{ i, e }] : []))
  for (let k = 1; k < narration.length; k++) {
    const a = narration[k - 1], b = narration[k]
    const between = ev.slice(a.i + 1, b.i)
    // The player acted, so they may have moved: none of our business.
    if (between.some((x) => x.type === 'intent_submitted')) continue
    tally.pairs++
    const { verdict, why } = await ask(String(a.e.payload?.text ?? ''), String(b.e.payload?.text ?? ''))
    if (verdict === 'SAME') { tally.same++; continue }
    if (verdict !== 'DIFFERENT') { tally.indeterminate++; continue }
    if (between.some((x) => MOVES.has(x.type))) { tally.moved++; continue }
    const gap = (Date.parse(b.e.created_at) - Date.parse(a.e.created_at)) / 1000
    if (gap >= CONCURRENT_S) { tally.progressed++; continue }
    tally.contradictions++
    console.log(`\nCONTRADICTION  ev${a.e.id} -> ev${b.e.id}  (+${gap.toFixed(2)}s, styles ${a.e.payload?.style}/${b.e.payload?.style})`)
    console.log(`   ${why}`)
  }
}
const rate = tally.pairs > 0 ? ((tally.contradictions / tally.pairs) * 100).toFixed(1) : '0.0'
console.log(`\n=== ${runs.length} runs | ${tally.pairs} in-scope pairs ===`)
console.log(`  same ${tally.same} | indeterminate ${tally.indeterminate} | authored move ${tally.moved} | progression ${tally.progressed}`)
console.log(`  CONTRADICTIONS ${tally.contradictions}  (${rate}% of in-scope pairs, lower bound)`)
