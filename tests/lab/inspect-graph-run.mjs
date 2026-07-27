// Post-run check for the authored-story-graph overhaul (2026-07-26). Answers the questions the
// unit tests cannot: did the runtime NAVIGATE the authored graph instead of planning, did the
// chip bypass fire, did personal stakes bind, and did any of the new guards trip?
//
// Usage: node tests/lab/inspect-graph-run.mjs <adventure_id>

import { serviceRest } from './shared.mjs'

const advId = process.argv[2]
if (!advId) throw new Error('usage: node tests/lab/inspect-graph-run.mjs <adventure_id>')

const log = (...a) => console.log(...a)

const events = await serviceRest(
  'GET', `event_log?adventure_id=eq.${advId}&select=id,type,payload,created_at&order=id&limit=4000`)
const nodes = await serviceRest(
  'GET', `story_nodes?adventure_id=eq.${advId}&select=id,key,kind,role,label,transitions`)
const beats = await serviceRest('GET', `core_loops?adventure_id=eq.${advId}&select=id`)
  .then((loops) => loops.length
    ? serviceRest('GET', `beats?core_loop_id=in.(${loops.map((l) => l.id).join(',')})&select=id,name,node_id,status,index&order=index`)
    : [])
const bindings = await serviceRest(
  'GET', `personal_bindings?adventure_id=eq.${advId}&select=character_id,intro_text,objective,status,reward_paid_at`)
const objectives = await serviceRest(
  'GET', `objectives?adventure_id=eq.${advId}&select=title,reveal_state,outcome,index&order=index`)

const byType = {}
for (const e of events) byType[e.type] = (byType[e.type] ?? 0) + 1

const nodeByKey = new Map(nodes.map((n) => [n.key, n]))
const nodeById = new Map(nodes.map((n) => [n.id, n]))

log('=== NAVIGATION ===')
const opened = events.filter((e) => e.type === 'beat_opened')
const fromGraph = opened.filter((e) => e.payload?.source === 'story_graph')
log(`beats opened: ${opened.length}  (from authored graph: ${fromGraph.length}, from runtime planner: ${opened.length - fromGraph.length})`)
for (const e of fromGraph) {
  log(`  ${String(e.payload.node_key)}  [${e.payload.node_role}/${e.payload.encounter_kind}] trigger=${e.payload.trigger}`)
}
const plannerFailures = events.filter((e) => /beat_planner_failure|beat_alignment_forced|climax_alignment_forced/.test(e.type))
log(`planner-era repair events (should be 0 on an authored graph): ${plannerFailures.length}`)
// Two very different things. `stopped` is an authored success edge resolving its objective and is
// healthy at roughly one per objective; `exhausted` is nothing authored left to play.
log(`navigation stopped (objective resolved): ${byType.graph_navigation_stopped ?? 0}`)
log(`navigation EXHAUSTED (nothing left):     ${byType.graph_navigation_exhausted ?? 0}`)

log('\n=== RESOLUTIONS & TRANSITIONS ===')
const resolved = events.filter((e) => e.type === 'encounter_resolved')
log(`encounters resolved: ${resolved.length}`)
for (const e of resolved) {
  const key = e.payload?.node_key
  const node = key ? nodeByKey.get(key) : null
  const edge = node?.transitions?.find((t) => t.on === e.payload.tier)
  log(`  ${e.payload.kind} "${String(e.payload.label).slice(0, 40)}" -> ${e.payload.tier}` +
    `${key ? `  node=${key} edge=${edge ? (edge.to_node_key ?? 'done') : 'NONE'}` : '  (no node_key - ad-hoc or legacy)'}` +
    `  milestones=${JSON.stringify(e.payload.milestones ?? [])}`)
}

log('\n=== ENTRY MAPPING (chip bypass + audit) ===')
const entries = events.filter((e) => e.type === 'entry_mapped')
const viaChip = entries.filter((e) => e.payload?.via === 'chip')
const withKey = entries.filter((e) => e.payload?.affordance_key)
log(`entry_mapped: ${entries.length}  (via chip - zero LLM: ${viaChip.length}, matched an affordance: ${withKey.length})`)
const byEntry = {}
for (const e of entries) byEntry[e.payload?.entry ?? '?'] = (byEntry[e.payload?.entry ?? '?'] ?? 0) + 1
log(`  breakdown: ${JSON.stringify(byEntry)}`)
for (const e of entries.slice(0, 8)) {
  log(`  [${e.payload.entry}${e.payload.affordance_key ? `/${e.payload.affordance_key}` : ''}] "${String(e.payload.text).slice(0, 70)}"`)
}

log('\n=== PERSONAL STAKES ===')
log(`personal_slots_bound events: ${byType.personal_slots_bound ?? 0}`)
log(`bindings: ${bindings.length}`)
for (const b of bindings) {
  log(`  ${b.status}  "${b.objective?.label ?? '?'}"  paid=${b.reward_paid_at ? 'yes' : 'no'}`)
  log(`    intro: ${String(b.intro_text).slice(0, 110)}`)
}
log(`personal_objective_completed: ${byType.personal_objective_completed ?? 0}`)

log('\n=== NEW GUARDS ===')
log(`outcome_claim_blocked (premature resolution): ${byType.outcome_claim_blocked ?? 0}`)
log(`claim_check_shadow (speaking corpse): ${byType.claim_check_shadow ?? 0}`)
log(`consistency_blocked: ${byType.consistency_blocked ?? 0}`)
log(`scene_effect_rejected: ${byType.scene_effect_rejected ?? 0}`)
log(`incident: ${byType.incident ?? 0}`)

log('\n=== STORY PROGRESS ===')
for (const o of objectives) log(`  ${o.index + 1}. [${o.reveal_state}${o.outcome ? `/${o.outcome}` : ''}] ${o.title}`)
log(`director actions: ${byType.director_action ?? 0}   ending_committed: ${byType.ending_committed ?? 0}`)
const rungs = {}
for (const e of events.filter((x) => x.type === 'director_action')) rungs[e.payload?.rung ?? '?'] = (rungs[e.payload?.rung ?? '?'] ?? 0) + 1
if (Object.keys(rungs).length) log(`  rungs fired: ${JSON.stringify(rungs)}`)

log('\n=== BEATS TABLE ===')
log(`beat rows: ${beats.length}  (linked to an authored node: ${beats.filter((b) => b.node_id).length})`)
for (const b of beats) log(`  #${b.index} [${b.status}] ${b.node_id ? nodeById.get(b.node_id)?.key ?? '?' : '(no node)'} - ${String(b.name).slice(0, 50)}`)

log('\n=== ALL EVENT TYPES ===')
log(JSON.stringify(Object.fromEntries(Object.entries(byType).sort((a, b) => b[1] - a[1])), null, 1))
