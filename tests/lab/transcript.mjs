// Dump a run's player-visible story in order, interleaved with the structural events that
// explain it. Reading this found defects the metrics missed - the placement bug came from
// reading, not from a number.
//
//   node transcript.mjs <adventure_id>
import { serviceRest } from './shared.mjs'

const adv = process.argv[2]
if (!adv) throw new Error('usage: node transcript.mjs <adventure_id>')

const ev = await serviceRest(
  'GET',
  `event_log?adventure_id=eq.${adv}&select=id,type,payload,created_at&order=id&limit=4000`,
)

const MARKERS = new Set([
  'beat_opened', 'scene_travel', 'objective_completed', 'objective_failed', 'loop_opened',
  'quest_completed', 'director_action', 'ending_committed', 'adventure_ended', 'incident',
  'narration_suppressed', 'stall_promoted',
])

let n = 0
let prev = null
for (const e of ev) {
  if (e.type === 'narration_published') {
    const gap = prev ? (new Date(e.created_at) - prev) / 1000 : 0
    prev = new Date(e.created_at)
    console.log(`\n[#${n++}] ${e.payload.source ?? 'narration'}  +${gap.toFixed(0)}s`)
    console.log(String(e.payload.text ?? '').trim())
    continue
  }
  if (e.type === 'intent_submitted') {
    const p = e.payload
    console.log(`\n  > ${p.actor_name ?? p.character_name ?? 'player'}: ${p.text ?? p.intent ?? ''}`)
    continue
  }
  if (MARKERS.has(e.type)) {
    console.log(`  -- ${e.type}: ${JSON.stringify(e.payload).slice(0, 200)}`)
  }
}
console.log(`\n=== ${n} narrations, ${ev.length} events ===`)
