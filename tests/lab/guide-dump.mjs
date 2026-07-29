// Dump an authored guide in reading order, free and instant. The structural linter and the
// playability prover already gate generation, so anything that ships is structurally sound -
// what they cannot see is whether the guide READS as a coherent story.
//
//   node guide-dump.mjs <adventure_id>
import { serviceRest } from './shared.mjs'

const adv = process.argv[2]
if (!adv) throw new Error('usage: node guide-dump.mjs <adventure_id>')

const [adventure] = await serviceRest(
  'GET', `adventures?id=eq.${adv}&select=title,status,plot_idea,meta_loop,min_players,max_players`)
const chapters = await serviceRest('GET', `chapters?adventure_id=eq.${adv}&select=id,index,title,arc_summary&order=index`)
const objectives = await serviceRest(
  'GET', `objectives?adventure_id=eq.${adv}&select=id,chapter_id,index,title,hidden_description,reveal_state,completion_predicates&order=index`)
const nodes = await serviceRest(
  'GET', `story_nodes?adventure_id=eq.${adv}&select=id,objective_id,key,index,role,kind,label,narration_seed,location_id,encounter_spec,affordances,transitions&order=key`)
const locations = await serviceRest('GET', `locations?adventure_id=eq.${adv}&select=id,name,description`)
const npcs = await serviceRest('GET', `npcs?adventure_id=eq.${adv}&select=id,name,initial_state,role`)
const endings = await serviceRest('GET', `endings?adventure_id=eq.${adv}&select=id,title,status,description`)

const locById = new Map(locations.map((l) => [l.id, l.name]))
const npcById = new Map(npcs.map((n) => [n.id, n.name]))

console.log(`# ${adventure.title}   [${adventure.status}]  party ${adventure.min_players}-${adventure.max_players}`)
console.log(`\nPREMISE\n${adventure.plot_idea ?? '(none)'}`)

console.log(`\n## LORE (the DM's briefing - these notes are what the party plays to find out)`)
for (const e of (adventure.meta_loop?.entities ?? []).filter((x) => x.kind === 'lore')) {
  console.log(`  - ${e.name}: ${e.note}`)
}

console.log(`\n## LOCATIONS`)
for (const l of locations) console.log(`  - ${l.name}: ${String(l.description ?? '').slice(0, 140)}`)

console.log(`\n## NPCS`)
for (const n of npcs) console.log(`  - ${n.name} [${n.initial_state}] ${n.role ?? ''}`)

for (const ch of chapters) {
  console.log(`\n\n=== CHAPTER ${ch.index + 1}: ${ch.title} ===`)
  if (ch.arc_summary) console.log(ch.arc_summary)
  for (const o of objectives.filter((x) => x.chapter_id === ch.id)) {
    console.log(`\n--- OBJECTIVE ${o.index}: ${o.title}  [${o.reveal_state}]`)
    console.log(`    HIDDEN: ${o.hidden_description ?? '(none)'}`)
    for (const n of nodes.filter((x) => x.objective_id === o.id)) {
      const spec = n.encounter_spec ?? {}
      const where = n.location_id ? locById.get(n.location_id) ?? '??' : '(unplaced - "here")'
      console.log(`\n    [${n.role}/${n.index}] ${n.kind.padEnd(16)} @ ${where}`)
      console.log(`      label   ${n.label}`)
      console.log(`      seed    ${n.narration_seed}`)
      console.log(`      stakes  ${spec.stakes ?? ''}`)
      console.log(`      win     ${JSON.stringify(spec.on_success ?? [])}`)
      console.log(`      lose    ${JSON.stringify(spec.on_failure ?? [])}`)
      const aff = (n.affordances ?? []).map((a) => a.hint || a.label)
      console.log(`      ways    ${aff.join(' | ')}`)
      for (const t of n.transitions ?? []) {
        if (t.on === 'full') continue
        console.log(`      ${t.on} -> ${t.toNodeKey ?? t.to_node_key ?? 'null'}: ${t.arrivalContext ?? t.arrival_context ?? ''}`)
      }
    }
  }
}

console.log(`\n\n## ENDINGS`)
for (const e of endings) console.log(`  [${e.status}] ${e.title}: ${String(e.description ?? '').slice(0, 200)}`)
