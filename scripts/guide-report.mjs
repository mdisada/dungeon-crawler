#!/usr/bin/env node
// Guide quality report - the numbers a generated guide has to answer for, in one command.
//
// WHY THIS EXISTS (2026-07-31). Every guide-quality figure quoted during the stage-4 work was
// computed by hand in a throwaway query, and one of those diagnoses turned out to be a coincidence:
// an NPC holding two clues appeared unstaged in a shipped guide, the prompt was changed to fix it,
// and re-authoring the same objective staged her BOTH with and without the change. Two runs of the
// same input produce different graphs, so a single sample cannot tell an improvement from luck.
//
// This prints the same measurements every time, so a prompt change is judged by a diff across
// several guides rather than by one hopeful reading.
//
//   node scripts/guide-report.mjs <adventure-id>     # one guide
//   node scripts/guide-report.mjs --all [limit]      # every generated guide, one line each
//
// Credentials: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY from the environment, else frontend/.env.local.

import { readFileSync } from 'node:fs'

function credentials() {
  let url = process.env.SUPABASE_URL
  let key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    try {
      const env = Object.fromEntries(
        readFileSync(new URL('../frontend/.env.local', import.meta.url), 'utf8')
          .split(/\r?\n/)
          .filter((l) => /^[A-Z_]+=/.test(l))
          .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).replace(/^"|"$/g, '')]),
      )
      url ??= env.SUPABASE_URL ?? env.VITE_SUPABASE_URL
      key ??= env.SUPABASE_SERVICE_ROLE_KEY
    } catch {
      // fall through to the error below
    }
  }
  if (!url || !key) {
    console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY, or run from a checkout with frontend/.env.local')
    process.exit(1)
  }
  return { url, key }
}

const { url, key } = credentials()
const HEADERS = { apikey: key, Authorization: `Bearer ${key}` }
const rest = async (path) => {
  const res = await fetch(`${url}/rest/v1/${path}`, { headers: HEADERS })
  const body = await res.json()
  if (!res.ok) throw new Error(`${path}: ${JSON.stringify(body).slice(0, 200)}`)
  return body
}

/** Every metric for one adventure. Pure counting - no model calls, no opinions. */
async function measure(adventureId) {
  const [adventure] = await rest(`adventures?id=eq.${adventureId}&select=id,title,status,type,min_players,max_players`)
  if (!adventure) throw new Error(`no adventure ${adventureId}`)

  const [chapters, objectives, npcs, locations, ingredients, nodes, warnings, contracts] = await Promise.all([
    rest(`chapters?adventure_id=eq.${adventureId}&select=id,index,title&order=index`),
    rest(`objectives?adventure_id=eq.${adventureId}&select=id,chapter_id,index,title`),
    rest(`npcs?adventure_id=eq.${adventureId}&select=id,name,role,initial_state,chapter_id`),
    rest(`locations?adventure_id=eq.${adventureId}&select=id,name,chapter_id`),
    rest(`ingredients?adventure_id=eq.${adventureId}&select=id,type,placement,objective_links`),
    rest(`story_nodes?adventure_id=eq.${adventureId}&select=id,key,kind,role,objective_id,location_id,encounter_spec`),
    rest(`guide_warnings?adventure_id=eq.${adventureId}&select=stage,kind,message`),
    rest(`quest_contracts?adventure_id=eq.${adventureId}&select=id,label,is_entry,giver_npc_id`),
  ])

  const npcById = new Map(npcs.map((n) => [n.id, n]))
  const locationById = new Map(locations.map((l) => [l.id, l]))
  const present = (n) => n && n.initial_state !== 'dead' && n.initial_state !== 'absent'

  // Live play surfaces a clue two ways and no others: searching the room it sits in
  // (discovery.ts) or talking to the person holding it (npc-dialogue.ts).
  // `stranded` is the one that matters: a clue whose ONLY door is a person who is dead or not yet
  // reachable. One that also sits in a searchable room has a second door and is fine - counting
  // those together overstated the first guide measured this way by 4x.
  const clues = { total: ingredients.length, unplaced: 0, onNpc: 0, inRoom: 0, stranded: 0, alsoInRoom: 0 }
  const cluesByNpc = new Map()
  const cluesByLocation = new Map()
  for (const ing of ingredients) {
    const placement = ing.placement ?? {}
    const npcId = typeof placement.npc_id === 'string' ? placement.npc_id : null
    const locationId = typeof placement.location_id === 'string' ? placement.location_id : null
    if (npcId) {
      clues.onNpc++
      cluesByNpc.set(npcId, (cluesByNpc.get(npcId) ?? 0) + 1)
      if (!present(npcById.get(npcId))) {
        if (locationId) clues.alsoInRoom++
        else clues.stranded++
      }
    }
    if (locationId) {
      clues.inRoom++
      cluesByLocation.set(locationId, (cluesByLocation.get(locationId) ?? 0) + 1)
    }
    if (!npcId && !locationId) clues.unplaced++
  }

  const stagedNpcIds = new Set()
  const stagedLocationIds = new Set()
  for (const node of nodes) {
    const params = node.encounter_spec?.params ?? {}
    for (const id of Array.isArray(params.npc_ids) ? params.npc_ids : []) stagedNpcIds.add(id)
    if (node.location_id) stagedLocationIds.add(node.location_id)
  }

  // A clue-holder no scene stages is evidence with no door: the reveal gate only ever fires in a
  // conversation the graph opened.
  const unstagedHolders = [...cluesByNpc.entries()]
    .filter(([id]) => !stagedNpcIds.has(id) && present(npcById.get(id)))
    .map(([id, count]) => `${npcById.get(id)?.name ?? id} x${count}`)
  // A room nothing stages is reachable - travel is open - but nothing ever points the party at it.
  const unvisitedClueRooms = [...cluesByLocation.entries()]
    .filter(([id]) => !stagedLocationIds.has(id))
    .map(([id, count]) => `${locationById.get(id)?.name ?? id} x${count}`)

  const livingNpcs = npcs.filter(present)
  const neverStaged = livingNpcs.filter((n) => !stagedNpcIds.has(n.id)).map((n) => n.name)

  const routeNodes = nodes.filter((n) => n.role === 'route')
  const kindCount = {}
  for (const node of routeNodes) kindCount[node.kind] = (kindCount[node.kind] ?? 0) + 1
  const routesByObjective = new Map()
  for (const node of routeNodes) {
    routesByObjective.set(node.objective_id, (routesByObjective.get(node.objective_id) ?? 0) + 1)
  }
  const thinObjectives = objectives
    .filter((o) => (routesByObjective.get(o.id) ?? 0) < 2)
    .map((o) => `${o.title} (${routesByObjective.get(o.id) ?? 0})`)
  // A social node staging nobody present can never open - the stage-8 gate refuses it.
  const unstageableSocial = routeNodes.filter((n) => {
    if (n.kind !== 'social') return false
    const ids = Array.isArray(n.encounter_spec?.params?.npc_ids) ? n.encounter_spec.params.npc_ids : []
    return !ids.some((id) => present(npcById.get(id)))
  }).length

  const entry = contracts.find((c) => c.is_entry)
  const entryGiver = entry ? npcById.get(entry.giver_npc_id) : null

  const gateFindings = warnings
    .filter((w) => w.stage === 8 && w.message.startsWith('[reachability:'))
    .map((w) => w.message.slice(14, w.message.indexOf(']')))
  const gateByCode = {}
  for (const code of gateFindings) gateByCode[code] = (gateByCode[code] ?? 0) + 1

  return {
    adventure,
    counts: {
      chapters: chapters.length,
      objectives: objectives.length,
      npcs: npcs.length,
      living: livingNpcs.length,
      locations: locations.length,
      nodes: nodes.length,
      routes: routeNodes.length,
    },
    clues,
    unstagedHolders,
    unvisitedClueRooms,
    neverStaged,
    kindCount,
    thinObjectives,
    unstageableSocial,
    entry: entry
      ? { label: entry.label, giver: entryGiver?.name ?? '(missing npc)', state: entryGiver?.initial_state ?? '?' }
      : null,
    warnings: {
      stage5: warnings.filter((w) => w.stage === 5).length,
      stage7major: warnings.filter((w) => w.stage === 7 && w.kind === 'warning').length,
      stage7minor: warnings.filter((w) => w.stage === 7 && w.kind === 'info').length,
      gate: gateByCode,
    },
  }
}

const pad = (label) => `${label}:`.padEnd(26)
const list = (items, limit = 4) =>
  items.length === 0 ? 'none' : `${items.length}  (${items.slice(0, limit).join(', ')}${items.length > limit ? ', …' : ''})`

function printReport(r) {
  const { adventure: a, counts: c } = r
  console.log(`\n${a.title || '(untitled)'}  [${a.status}]  ${a.id}`)
  console.log(`${pad('  shape')}${c.chapters} chapters, ${c.objectives} objectives, ${c.nodes} nodes (${c.routes} route)`)
  console.log(`${pad('  cast')}${c.npcs} NPCs (${c.living} present), ${c.locations} locations`)
  console.log(`${pad('  clues')}${r.clues.total} total - ${r.clues.onNpc} on people, ${r.clues.inRoom} in rooms`)
  console.log(`${pad('  UNPLACED clues')}${r.clues.unplaced}${r.clues.unplaced > 0 ? '  <- unreachable in play' : ''}`)
  console.log(`${pad('  STRANDED clues')}${r.clues.stranded}${r.clues.stranded > 0 ? '  <- only door is someone dead/unreachable' : ''}`)
  console.log(`${pad('  on dead/absent + a room')}${r.clues.alsoInRoom}${r.clues.alsoInRoom > 0 ? '  (searchable, fine)' : ''}`)
  console.log(`${pad('  clue-holders unstaged')}${list(r.unstagedHolders)}`)
  console.log(`${pad('  clue rooms unvisited')}${list(r.unvisitedClueRooms)}`)
  console.log(`${pad('  NPCs never staged')}${list(r.neverStaged)}`)
  const kinds = Object.entries(r.kindCount).map(([k, n]) => `${k} x${n}`).join(', ') || 'none'
  const combat = r.kindCount.combat ?? 0
  console.log(`${pad('  node kinds')}${kinds}`)
  console.log(`${pad('  combat')}${combat}${combat < 1 ? '  <- below the floor (play forces one)' : combat > 3 ? '  <- over the ceiling' : ''}`)
  console.log(`${pad('  objectives < 2 routes')}${list(r.thinObjectives)}`)
  console.log(`${pad('  unstageable social')}${r.unstageableSocial}`)
  console.log(`${pad('  entry contract')}${r.entry ? `${r.entry.giver} [${r.entry.state}] - ${r.entry.label}` : 'NONE'}`)
  const gate = Object.entries(r.warnings.gate).map(([k, n]) => `${k} x${n}`).join(', ') || 'clean'
  console.log(`${pad('  gate')}${gate}`)
  console.log(`${pad('  stage 7')}${r.warnings.stage7major} major, ${r.warnings.stage7minor} minor`)
  console.log(`${pad('  stage 5')}${r.warnings.stage5} warnings`)
}

function printRow(r) {
  const { adventure: a } = r
  const bad = [
    r.clues.unplaced > 0 ? `${r.clues.unplaced} unplaced` : '',
    r.clues.stranded > 0 ? `${r.clues.stranded} stranded` : '',
    r.unstagedHolders.length > 0 ? `${r.unstagedHolders.length} holder(s) unstaged` : '',
    (r.kindCount.combat ?? 0) < 1 ? 'no combat' : '',
    r.entry && r.entry.state !== 'alive' ? `giver ${r.entry.state}` : '',
    r.thinObjectives.length > 0 ? `${r.thinObjectives.length} thin` : '',
  ].filter(Boolean)
  console.log(
    `${(a.title || '(untitled)').slice(0, 28).padEnd(30)}` +
    `${String(r.clues.total).padStart(3)} clues  ${String(r.counts.routes).padStart(3)} routes  ` +
    `${String(r.warnings.stage7major).padStart(2)} maj  ${bad.join(', ') || 'clean'}`,
  )
}

const [arg, limitArg] = process.argv.slice(2)
if (!arg) {
  console.error('Usage: node scripts/guide-report.mjs <adventure-id> | --all [limit]')
  process.exit(1)
}

if (arg === '--all') {
  const limit = Number(limitArg ?? 20)
  const adventures = await rest(
    `adventures?select=id,title,created_at&order=created_at.desc&limit=${limit}`,
  )
  for (const a of adventures) {
    try {
      const r = await measure(a.id)
      if (r.counts.nodes === 0 && r.clues.total === 0) continue
      printRow(r)
    } catch (err) {
      console.error(`${a.title ?? a.id}: ${err.message}`)
    }
  }
} else {
  printReport(await measure(arg))
}
