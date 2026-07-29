// Where does a name FIRST enter the guide?
//
//   node name-provenance.mjs <adventure_id> [Name] [Name...]
//
// The pipeline is top-down and each hand-off is governed: stage 1 registers entities, stage 2
// names the chapter's own, stage 4 MUST make a row for each (validateEntityCoverage), stage 5b
// picks npc/location keys from a closed vocabulary. So an unregistered name did not come from
// nowhere - it entered at one specific stage, in one specific field. That is the field to govern.
import { serviceRest } from './shared.mjs'

const adv = process.argv[2]
if (!adv) throw new Error('usage: node name-provenance.mjs <adventure_id> [Name...]')
const wanted = process.argv.slice(3)

const [adventure] = await serviceRest('GET', `adventures?id=eq.${adv}&select=title,plot_idea,meta_loop`)
const chapters = await serviceRest('GET', `chapters?adventure_id=eq.${adv}&select=id,index,title,arc_summary,entities&order=index`)
const scenes = await serviceRest('GET', `scenes?adventure_id=eq.${adv}&select=chapter_id,index,sketch&order=index`)
const objectives = await serviceRest('GET', `objectives?adventure_id=eq.${adv}&select=index,title,hidden_description&order=index`)
const nodes = await serviceRest('GET', `story_nodes?adventure_id=eq.${adv}&select=key,label,narration_seed,transitions,encounter_spec&order=key`)
const ingredients = await serviceRest('GET', `ingredients?adventure_id=eq.${adv}&select=content,reveals`)
const npcs = await serviceRest('GET', `npcs?adventure_id=eq.${adv}&select=name`)
const locations = await serviceRest('GET', `locations?adventure_id=eq.${adv}&select=name`)

// Ordered by the stage that produced it - the first hit is where the name was invented.
const SOURCES = [
  ['stage1 plot_idea', adventure.plot_idea],
  ['stage1 meta_loop', JSON.stringify(adventure.meta_loop)],
  ...chapters.map((c) => [`stage1 chapter${c.index + 1}.arc_summary`, c.arc_summary]),
  ...chapters.map((c) => [`stage2 chapter${c.index + 1}.entities`, JSON.stringify(c.entities ?? [])]),
  ...scenes.map((s, i) => [`stage2 scene[${i}]`, s.sketch]),
  ...objectives.map((o) => [`stage3 objective${o.index}.title`, o.title]),
  ...objectives.map((o) => [`stage3 objective${o.index}.hidden_description`, o.hidden_description]),
  ['stage4 npcs (ROWS)', npcs.map((n) => n.name).join(' | ')],
  ['stage4 locations (ROWS)', locations.map((l) => l.name).join(' | ')],
  ...ingredients.map((g, i) => [`stage4 ingredient[${i}]`, `${g.content} ${g.reveals ?? ''}`]),
  ...nodes.map((n) => [`stage5b ${n.key.slice(-3)}.label`, n.label]),
  ...nodes.map((n) => [`stage5b ${n.key.slice(-3)}.narration_seed`, n.narration_seed]),
  ...nodes.map((n) => [`stage5b ${n.key.slice(-3)}.setback_line`,
    (n.transitions ?? []).map((t) => t.arrival_context ?? t.arrivalContext ?? '').join(' ')]),
  ...nodes.map((n) => [`stage5b ${n.key.slice(-3)}.outcome`, JSON.stringify(n.outcome_summary ?? '')]),
]

const registered = new Set([...npcs.map((n) => n.name), ...locations.map((l) => l.name)])

for (const name of wanted) {
  console.log(`\n=== "${name}" ===`)
  console.log(`   registered as a row? ${registered.has(name) ? 'YES' : 'NO'}`)
  const hits = SOURCES.filter(([, text]) => String(text ?? '').includes(name))
  if (hits.length === 0) { console.log('   (never appears)'); continue }
  console.log(`   first appears: ${hits[0][0]}`)
  console.log(`   appears in ${hits.length} field(s):`)
  for (const [where] of hits) console.log(`     - ${where}`)
}
