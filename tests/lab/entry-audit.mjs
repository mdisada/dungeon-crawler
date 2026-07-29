// Where do cutscene inputs GO? The entry mapper's filing cabinet, audited (2026-07-29).
//
// `fold_in` dominance was the top open item, described as "10 of 15 mapped intents absorbed
// without advancing anything". It reproduces across every run (76%, n=102), but the cause is not
// what the framing assumed - so this exists to keep the question measurable rather than anecdotal.
//
// Two things it separates, which the raw entry label conflates:
//
//   WHY the fold - the model's own verdict, or the `offered && !spec -> fold_in` downgrade in
//     entry.ts. Runs after 2026-07-29 carry `mapper_entry` / `had_offer` in the event payload;
//     older ones are reconstructed by joining beats and `encounter_resolved` (the "a scene that
//     has been played is not on offer" rule), which is why that join lives here.
//
//   WHAT was folded - a question, an examination, or a real physical action. The first two are
//     investigation and the taxonomy has no bucket for them; the third is a misfile.
//
//   node tests/lab/entry-audit.mjs <adventure_id> [<adventure_id> ...]
import { serviceRest } from './shared.mjs'

const advs = process.argv.slice(2)
if (advs.length === 0) throw new Error('usage: node entry-audit.mjs <adventure_id> [...]')

// Deliberately crude, and reported as counts rather than believed as truth: these are prose
// heuristics like guide-audit's, not proofs. Read the listing under -v before acting on a number.
const META = /^(what do i|what now|idk|what should|what happens now)/i
const QUESTION = /^(who|what|where|why|how|did|is|are|does|can)\b/i
const EXAMINE = /\b(look|examine|inspect|check|study|read|glance|watch|search)\b/i
const PHYSICAL = /\b(grab|shove|push|haul|pull|take|throw|strike|kick|climb|draw|scrawl|drag|force|open|slam)\b/i

const classify = (text) => {
  const t = text.trim()
  if (META.test(t)) return 'meta'
  if (t.includes('?') || QUESTION.test(t)) return 'question'
  if (EXAMINE.test(t)) return 'examine'
  if (PHYSICAL.test(t)) return 'physical'
  return 'other'
}

const totals = { offered: 0, adhoc: 0, fold_in: 0 }
const causes = { model: 0, downgrade_no_beat: 0, downgrade_played: 0, downgrade_no_spec: 0 }
const shapes = { question: 0, examine: 0, physical: 0, meta: 0, other: 0 }
const misfiled = []
const streaks = []

for (const adv of advs) {
  const ev = await serviceRest(
    'GET',
    `event_log?adventure_id=eq.${adv}&select=type,payload,created_at&order=id&limit=4000`,
  )
  const mapped = ev.filter((e) => e.type === 'entry_mapped')
  const beatIds = [...new Set(mapped.map((e) => e.payload.beat_id).filter(Boolean))]
  const beats = beatIds.length
    ? await serviceRest('GET', `beats?id=in.(${beatIds.join(',')})&select=id,encounter_spec`)
    : []
  const specById = new Map(beats.map((b) => [b.id, b.encounter_spec]))

  // First resolution per node - after it, `openBeatSpec` serves null however active the beat is.
  const resolvedAt = new Map()
  for (const e of ev) {
    const key = e.payload?.node_key
    if (e.type === 'encounter_resolved' && key && !resolvedAt.has(key)) resolvedAt.set(key, e.created_at)
  }

  const hadOffer = (e) => {
    if (typeof e.payload.had_offer === 'boolean') return e.payload.had_offer ? 'live' : 'none'
    if (!e.payload.beat_id) return 'no_beat'
    const spec = specById.get(e.payload.beat_id)
    if (!spec?.kind) return 'no_spec'
    const nodeKey = spec.nodeKey ?? spec.node_key
    const at = nodeKey ? resolvedAt.get(nodeKey) : null
    return at && at < e.created_at ? 'played' : 'live'
  }

  const local = { offered: 0, adhoc: 0, fold_in: 0 }
  let streak = 0
  for (const e of mapped) {
    const { entry, text = '' } = e.payload
    local[entry] = (local[entry] ?? 0) + 1
    totals[entry] = (totals[entry] ?? 0) + 1
    if (entry !== 'fold_in') {
      if (streak) streaks.push(streak)
      streak = 0
      continue
    }
    streak++

    const offer = hadOffer(e)
    if (offer === 'no_beat') causes.downgrade_no_beat++
    else if (offer === 'played') causes.downgrade_played++
    else if (offer === 'no_spec') causes.downgrade_no_spec++
    else causes.model++

    const shape = classify(text)
    shapes[shape]++
    // A fold is DEFINED as "talk and colour that changes nothing about where the party stands".
    // A physical action is none of those things, and folding one absorbs a real move.
    if (shape === 'physical') {
      const spec = specById.get(e.payload.beat_id)
      misfiled.push(`${adv.slice(0, 8)} [hook: ${spec?.kind ?? 'none'}] ${text.replace(/\s+/g, ' ').slice(0, 90)}`)
    }
  }
  if (streak) streaks.push(streak)

  const n = mapped.length
  const pct = n ? Math.round((100 * local.fold_in) / n) : 0
  console.log(
    `${adv.slice(0, 8)}  n=${String(n).padStart(3)}  offered=${local.offered}  ` +
      `adhoc=${local.adhoc}  fold_in=${local.fold_in} (${pct}%)`,
  )
}

const n = totals.offered + totals.adhoc + totals.fold_in
const folds = totals.fold_in
const share = (k, d) => `${String(k).padStart(3)}  ${d ? Math.round((100 * k) / d) : 0}%`

console.log(`\n=== ${n} mapped intents across ${advs.length} run(s) ===`)
console.log(`offered  ${share(totals.offered, n)}`)
console.log(`adhoc    ${share(totals.adhoc, n)}`)
console.log(`fold_in  ${share(folds, n)}`)

console.log(`\n--- why the ${folds} folds ---`)
console.log(`model's own call       ${share(causes.model, folds)}   (a spec WAS on offer)`)
console.log(`downgrade: no beat     ${share(causes.downgrade_no_beat, folds)}`)
console.log(`downgrade: node played ${share(causes.downgrade_played, folds)}`)
console.log(`downgrade: no spec     ${share(causes.downgrade_no_spec, folds)}`)

console.log('\n--- what was folded ---')
for (const [k, v] of Object.entries(shapes)) console.log(`${k.padEnd(9)}${share(v, folds)}`)

// Streaks are the stall SHAPE. The anti-circling guard reads the last 3 entries and only catches a
// repeat of the same push, so a run of eight DIFFERENT questions never trips it.
const sorted = streaks.sort((a, b) => b - a)
console.log(`\nconsecutive-fold streaks: ${sorted.join(',') || 'none'}  longest=${sorted[0] ?? 0}`)

if (misfiled.length > 0) {
  console.log(`\n--- physical actions folded as colour (${misfiled.length}) ---`)
  for (const m of misfiled) console.log(`  ${m}`)
}
