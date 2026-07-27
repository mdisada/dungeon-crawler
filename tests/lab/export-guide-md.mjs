// Export an authored guide as a READABLE markdown document, so a human can judge the story on its
// own terms instead of reading table rows. Static: no play, no LLM, no spend.
//
//   node tests/lab/export-guide-md.mjs <adventure_id> [more ids...]
//   node tests/lab/export-guide-md.mjs --recent 5
//
// Writes tests/lab/guides/<slug>.md and prints an audit summary per guide. The audit checks the
// defect classes found live on 2026-07-27/28: contract coverage that does not span the objective
// ladder (which strands every objective outside it), endings whose climax claim is outweighed by
// side signals, non-ASCII corruption in shipped prose, and objectives whose route nodes establish
// different facts (the knowledge-continuity hole the alternatives model creates).
import { mkdirSync, writeFileSync } from 'node:fs'

import { serviceRest } from './shared.mjs'

const OUT_DIR = 'tests/lab/guides'

const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim()
/** Anything outside printable Latin-1 + common typography is corruption in authored prose. */
const NON_LATIN = /[^\x09\x0A\x0D\x20-\x7E -ɏ‐-›€]/g

async function loadGuide(advId) {
  const one = async (t, q) => (await serviceRest('GET', `${t}?adventure_id=eq.${advId}&${q}`))
  const [adventure] = await serviceRest('GET', `adventures?id=eq.${advId}&select=*`)
  if (!adventure) throw new Error(`no adventure ${advId}`)
  const [chapters, objectives, nodes, npcs, locations, endings, contracts, ingredients, warnings, atoms] =
    await Promise.all([
      one('chapters', 'select=id,index,title,arc_summary&order=index'),
      one('objectives', 'select=id,chapter_id,index,title,hidden_description,reveal_state,completion_predicates&order=index'),
      one('story_nodes', 'select=id,objective_id,key,index,role,kind,label,narration_seed,encounter_spec,affordances,transitions&order=index'),
      one('npcs', 'select=id,name,role,initial_state,description'),
      one('locations', 'select=id,name,description'),
      one('endings', 'select=id,index,title,tone,description,climax_summary,trigger_conditions&order=index'),
      one('quest_contracts', 'select=id,is_entry,label,giver_npc_id,objective_ids,reward,stakes,deadline'),
      one('ingredients', 'select=id,type,reveals'),
      one('guide_warnings', 'select=stage,kind,message&order=stage'),
      one('story_atoms', 'select=slug,kind,scope'),
    ])
  return { adventure, chapters, objectives, nodes, npcs, locations, endings, contracts, ingredients, warnings, atoms }
}

/** Plain-English rendering of one ending signal. */
function signalText(sig, objById, npcById) {
  const w = sig.when ?? {}
  const sign = sig.weight > 0 ? `+${sig.weight}` : `${sig.weight}`
  if (w.objective_id) return `${sign} if **${objById.get(w.objective_id) ?? w.objective_id}** is *${w.outcome}*`
  if (w.npc_id) return `${sign} if **${npcById.get(w.npc_id) ?? w.npc_id}** is *${w.state}*`
  if (w.dial) {
    const bound = [w.gte !== undefined ? `>= ${w.gte}` : null, w.lte !== undefined ? `<= ${w.lte}` : null].filter(Boolean).join(' and ')
    return `${sign} if dial *${w.dial}* ${bound}`
  }
  return `${sign} (unrecognised signal)`
}

function audit(g) {
  const findings = []
  const objIds = g.objectives.map((o) => o.id)
  const climaxId = objIds[objIds.length - 1]

  // 1. Contract coverage. An objective in no contract cannot pay out, and when the contract that
  //    DOES cover the early ladder completes, its loop closes under everything that follows.
  const covered = new Set(g.contracts.flatMap((c) => c.objective_ids ?? []))
  const entry = g.contracts.find((c) => c.is_entry)
  const uncovered = objIds.filter((id) => !covered.has(id))
  if (entry) {
    const n = (entry.objective_ids ?? []).length
    if (n < objIds.length) {
      findings.push(`**Entry contract covers ${n}/${objIds.length} objectives.** When it completes, its loop closes while later objectives are still to come.`)
    }
  } else findings.push('**No entry contract** - the adventure has no opening offer.')
  if (uncovered.length) findings.push(`${uncovered.length} objective(s) belong to no contract at all: ${uncovered.map((id) => g.objectives.find((o) => o.id === id)?.title).join('; ')}`)

  // 2. Endings: can a side-signal total beat the climax claim?
  for (const e of g.endings) {
    const sigs = e.trigger_conditions?.signals ?? []
    const onClimax = sigs.filter((s) => s.when?.objective_id === climaxId)
    if (onClimax.length === 0) { findings.push(`Ending **${e.title}** has no climax signal - it can win on side signals alone.`); continue }
    const claim = onClimax.filter((s) => s.weight > 0).reduce((m, s) => Math.max(m, s.weight), 0)
    const side = sigs.filter((s) => s.weight > 0 && s.when?.objective_id !== climaxId).reduce((t, s) => t + s.weight, 0)
    if (side > claim) findings.push(`Ending **${e.title}**: side signals total +${side} vs a climax claim of +${claim} - it can land while its own premise is false.`)
  }

  // 3. Non-ASCII corruption in prose the player will read.
  const prose = [
    ...g.endings.flatMap((e) => [e.description, e.climax_summary]),
    ...g.nodes.map((n) => n.narration_seed),
    ...g.npcs.map((n) => n.description),
    ...g.locations.map((l) => l.description),
  ].filter(Boolean)
  for (const t of prose) {
    const bad = String(t).match(NON_LATIN)
    if (bad) findings.push(`Corrupted characters in authored prose (\`${[...new Set(bad)].join('')}\`): "${clean(t).slice(0, 70)}..."`)
  }

  // 4. Knowledge continuity: route nodes of one objective awarding DIFFERENT success atoms means
  //    downstream content cannot assume any particular fact was learned.
  for (const o of g.objectives) {
    const routes = g.nodes.filter((n) => n.objective_id === o.id && n.role === 'route')
    if (routes.length < 2) continue
    const sets = routes.map((n) => JSON.stringify([...(n.encounter_spec?.on_success ?? [])].sort()))
    if (new Set(sets).size > 1) {
      findings.push(`Objective **${o.title}**: its route nodes award different facts (${sets.join(' vs ')}) - later content cannot rely on either.`)
    }
  }

  // 5. Every objective needs at least one route and the ladder needs a rescue.
  for (const o of g.objectives) {
    const mine = g.nodes.filter((n) => n.objective_id === o.id)
    if (mine.length === 0) findings.push(`Objective **${o.title}** has NO authored scenes.`)
    else if (!mine.some((n) => n.role === 'rescue')) findings.push(`Objective **${o.title}** has no rescue node - a failing party has no floor.`)
  }
  return findings
}

function render(g) {
  const a = g.adventure
  const objById = new Map(g.objectives.map((o) => [o.id, o.title]))
  const npcById = new Map(g.npcs.map((n) => [n.id, n.name]))
  const L = []
  L.push(`# ${a.title}`, '', `*${a.type} | mode ${a.mode} | status ${a.status}*`, '')
  if (a.plot_idea) L.push('> ' + clean(a.plot_idea), '')
  const meta = a.meta_loop ?? {}
  if (meta.premise) L.push('## Premise', '', clean(meta.premise), '')
  if (meta.antagonist || meta.bbeg) L.push(`**Antagonist:** ${clean(meta.antagonist ?? meta.bbeg)}`, '')

  L.push('## The job offered', '')
  for (const c of g.contracts) {
    const r = c.reward ?? {}
    L.push(`- **${c.is_entry ? 'ENTRY' : 'side'}: ${c.label ?? '(unnamed)'}** - giver ${npcById.get(c.giver_npc_id) ?? 'unknown'}, ${r.gold_floor ?? '?'}-${r.gold_ceiling ?? '?'} gp${c.deadline?.days ? `, due in ${c.deadline.days} days` : ''}`)
    if (c.stakes) L.push(`  - stakes: ${clean(c.stakes)}`)
    L.push(`  - covers ${(c.objective_ids ?? []).length}/${g.objectives.length} objectives: ${(c.objective_ids ?? []).map((id) => objById.get(id) ?? '?').join('; ') || 'none'}`)
  }
  L.push('')

  L.push('## The spine', '')
  for (const ch of g.chapters) {
    L.push(`### Chapter ${ch.index + 1}: ${ch.title}`, '', clean(ch.arc_summary), '')
    for (const o of g.objectives.filter((x) => x.chapter_id === ch.id)) {
      L.push(`#### ${o.index + 1}. ${o.title}`, '')
      if (o.hidden_description) L.push(`*DM intent:* ${clean(o.hidden_description)}`, '')
      const mine = g.nodes.filter((n) => n.objective_id === o.id).sort((x, y) => (x.role === y.role ? x.index - y.index : x.role === 'route' ? -1 : 1))
      if (!mine.length) L.push('> **No authored scenes.**', '')
      for (const n of mine) {
        const spec = n.encounter_spec ?? {}
        L.push(`- **${n.role === 'rescue' ? 'RESCUE' : 'Route'} - ${n.label}** *(${n.kind})*`)
        L.push(`  - ${clean(n.narration_seed)}`)
        if (spec.stakes) L.push(`  - at stake: ${clean(spec.stakes)}`)
        const aff = (n.affordances ?? []).map((x) => x.label ?? x.key)
        if (aff.length) L.push(`  - ways in: ${aff.join(' / ')}`)
        if ((spec.on_success ?? []).length) L.push(`  - on success: \`${(spec.on_success).join('`, `')}\``)
        if ((spec.on_failure ?? []).length) L.push(`  - on failure: \`${(spec.on_failure).join('`, `')}\``)
        for (const t of n.transitions ?? []) {
          const to = t.to_node_key ? g.nodes.find((x) => x.key === t.to_node_key)?.label ?? t.to_node_key : '**objective resolves**'
          L.push(`  - on *${t.on}* -> ${to}${t.arrival_context ? ` — "${clean(t.arrival_context)}"` : ''}`)
        }
      }
      L.push('')
    }
  }

  L.push('## Cast', '')
  for (const n of g.npcs) L.push(`- **${n.name}**${n.role ? ` (${n.role})` : ''}${n.initial_state && n.initial_state !== 'alive' ? ` *[${n.initial_state}]*` : ''} - ${clean(n.description).slice(0, 220)}`)
  L.push('', '## Places', '')
  for (const l of g.locations) L.push(`- **${l.name}** - ${clean(l.description).slice(0, 200)}`)

  L.push('', '## Endings', '')
  for (const e of g.endings) {
    L.push(`### ${e.title} *(${e.tone})*`, '', clean(e.description), '')
    if (e.climax_summary) L.push(`*Authored climax:* ${clean(e.climax_summary)}`, '')
    L.push('Scores when:', '')
    for (const s of e.trigger_conditions?.signals ?? []) L.push(`- ${signalText(s, objById, npcById)}${s.note ? ` — ${clean(s.note)}` : ''}`)
    L.push('')
  }

  const findings = audit(g)
  L.push('## Audit', '')
  if (!findings.length) L.push('No structural findings.', '')
  else findings.forEach((f) => L.push(`- ${f}`))
  L.push('')
  if (g.warnings.length) {
    L.push('### What the pipeline itself flagged', '')
    for (const w of g.warnings) L.push(`- *stage ${w.stage}* **[${w.kind}]** ${clean(w.message)}`)
    L.push('')
  }
  return { md: L.join('\n'), findings }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  let ids = process.argv.slice(2)
  if (ids[0] === '--recent') {
    const n = Number(ids[1] ?? 5)
    const rows = await serviceRest('GET', `adventures?status=in.(guide_ready,active,completed)&select=id,title,created_at&order=created_at.desc&limit=${n}`)
    ids = rows.map((r) => r.id)
  }
  if (!ids.length) throw new Error('usage: export-guide-md.mjs <adventure_id...> | --recent N')

  for (const id of ids) {
    try {
      const g = await loadGuide(id)
      const { md, findings } = render(g)
      const path = `${OUT_DIR}/${slug(g.adventure.title)}-${id.slice(0, 8)}.md`
      writeFileSync(path, md)
      console.log(`\n${path}`)
      console.log(`  ${g.chapters.length} chapters | ${g.objectives.length} objectives | ${g.nodes.length} nodes | ${g.npcs.length} npcs | ${g.endings.length} endings`)
      console.log(`  findings: ${findings.length}${findings.length ? '' : '  (clean)'}`)
      findings.forEach((f) => console.log('    - ' + f.replace(/\*\*/g, '')))
    } catch (err) {
      console.error(`\n${id}: FAILED - ${err.message}`)
    }
  }
}

main().catch((err) => { console.error(err.message); process.exit(1) })
