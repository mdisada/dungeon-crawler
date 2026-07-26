// One-shot guide generation for the authored-story-graph overhaul (2026-07-26).
//
// Generates a fresh adventure end to end and reports what the new machinery produced: story
// nodes per objective, their transitions/affordances/outcome maps, personal slots, the atom
// registry by scope, and every reachability finding. Costs a normal guide generation (~$0.02).
//
// Usage: node tests/lab/generate-guide.mjs [--type one_shot|multi_chapter] [--party 3]

import { createConfirmedUser, env, pipeline, serviceRest, signIn, sleep } from './shared.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 ? process.argv[i + 1] : fallback
}

const TYPE = arg('type', 'one_shot')
const PARTY = Number(arg('party', 3))
const PLOT = {
  title: 'The Salt-Wake Ledger',
  idea: 'A harbour town\'s tide-ledger records ships that never sailed. The harbourmaster is ' +
    'paid to keep writing them, and something in the water is collecting on the debt.',
}

const log = (...args) => console.log(...args)

async function spentUsd(adventureId) {
  const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${adventureId}&select=cost_usd`)
  return rows.reduce((sum, r) => sum + Number(r.cost_usd ?? 0), 0)
}

async function main() {
  const stamp = Date.now()
  const email = `graphgen-${stamp}@example.com`
  const password = `Lab-password-${stamp}!`
  const userId = await createConfirmedUser(email, password)
  const token = await signIn(email, password)

  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userId, mode: 'full_ai', min_players: 1, max_players: PARTY,
    type: TYPE, status: 'draft', demo: false, title: PLOT.title, plot_idea: PLOT.idea,
  })
  const advId = adventure.id
  log(`adventure ${advId} (${TYPE}, max_players ${PARTY})`)

  const started = await pipeline(token, { action: 'start', adventure_id: advId })
  if (started.status !== 202) throw new Error(`pipeline start failed: ${JSON.stringify(started)}`)

  let status = 'generating'
  let retries = 0
  let fingerprint = ''
  let stall = 0
  let lastDone = -1
  for (let i = 0; i < 400 && status === 'generating'; i++) {
    await sleep(4000)
    const [row] = await serviceRest('GET', `adventures?id=eq.${advId}&select=status`)
    status = row.status
    const jobs = await serviceRest('GET', `guide_jobs?adventure_id=eq.${advId}&select=id,stage,status,error&order=stage`)
    const failed = jobs.find((j) => j.status === 'failed')
    if (failed) {
      if (retries >= 4) throw new Error(`stage ${failed.stage} failed ${retries}x: ${failed.error}`)
      retries++
      log(`  ! stage ${failed.stage} failed (retry ${retries}): ${String(failed.error).slice(0, 300)}`)
      await pipeline(token, { action: 'retry', job_id: failed.id })
      status = 'generating'
      continue
    }
    const next = jobs.map((j) => `${j.id}:${j.status}`).join('|')
    const pending = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (pending && next === fingerprint) {
      if (++stall >= 4) { stall = 0; await pipeline(token, { action: 'run', adventure_id: advId }) }
    } else stall = 0
    fingerprint = next
    const done = jobs.filter((j) => j.status === 'done').length
    if (done !== lastDone) { lastDone = done; log(`  stages ${done}/${jobs.length}`) }
  }
  if (status !== 'guide_ready') throw new Error(`guide never became ready (${status})`)
  log(`guide_ready  ($${(await spentUsd(advId)).toFixed(4)})\n`)

  // ---- What the overhaul produced ----
  const [objectives, nodes, slots, atoms, warnings, npcs] = await Promise.all([
    serviceRest('GET', `objectives?adventure_id=eq.${advId}&select=id,index,title,completion_predicates,guaranteed_route&order=index`),
    serviceRest('GET', `story_nodes?adventure_id=eq.${advId}&select=id,key,objective_id,index,kind,role,label,narration_seed,encounter_spec,affordances,transitions,local_atoms&order=key`),
    serviceRest('GET', `personal_slots?adventure_id=eq.${advId}&select=key,archetype,intro_seed,objective_template,overlay_attachments`),
    serviceRest('GET', `story_atoms?adventure_id=eq.${advId}&select=slug,kind,scope`),
    serviceRest('GET', `guide_warnings?adventure_id=eq.${advId}&select=stage,message,kind`),
    serviceRest('GET', `npcs?adventure_id=eq.${advId}&select=id,name,initial_state`),
  ])
  const npcName = Object.fromEntries(npcs.map((n) => [n.id, n.name]))

  log(`=== OBJECTIVES (${objectives.length}) ===`)
  for (const o of objectives) {
    const mine = nodes.filter((n) => n.objective_id === o.id)
    const routes = mine.filter((n) => n.role === 'route')
    const rescue = mine.filter((n) => n.role === 'rescue')
    log(`${o.index + 1}. ${o.title}`)
    log(`   predicate: ${JSON.stringify(o.completion_predicates)}`)
    log(`   nodes: ${routes.length} route + ${rescue.length} rescue`)
  }

  log(`\n=== STORY NODES (${nodes.length}) ===`)
  for (const n of nodes) {
    const spec = n.encounter_spec ?? {}
    const aff = (n.affordances ?? []).map((a) => a.key).join(', ')
    const trans = (n.transitions ?? []).map((t) => `${t.on}->${t.to_node_key ?? 'done'}`).join('  ')
    const staged = ((spec.params ?? {}).npc_ids ?? []).map((id) => npcName[id] ?? `?${id.slice(0, 6)}`).join(', ')
    log(`${n.key}  [${n.kind}/${n.role}]  ${n.label}`)
    log(`   seed: ${String(n.narration_seed).slice(0, 110)}`)
    log(`   success:${JSON.stringify(spec.on_success ?? [])} partial:${JSON.stringify(spec.on_partial ?? [])} failure:${JSON.stringify(spec.on_failure ?? [])}`)
    log(`   chips: ${aff || '(none)'}${staged ? `   staged: ${staged}` : ''}`)
    log(`   exits: ${trans || '(none)'}`)
    for (const t of n.transitions ?? []) {
      if (t.on !== 'full' && t.to_node_key && !String(t.arrival_context ?? '').trim()) {
        log(`   !! ${t.on} edge has NO arrival_context`)
      }
    }
  }

  log(`\n=== PERSONAL SLOTS (${slots.length}) ===`)
  for (const s of slots) {
    const t = s.objective_template ?? {}
    log(`${s.key}: ${t.label ?? '(no label)'}  reward=${JSON.stringify(t.reward ?? {})}`)
    log(`   predicate: ${JSON.stringify(t.predicate)}`)
    log(`   overlays: ${(s.overlay_attachments ?? []).map((o) => o.node_key).join(', ') || '(none)'}`)
  }

  const byScope = atoms.reduce((acc, a) => { acc[a.scope] = (acc[a.scope] ?? 0) + 1; return acc }, {})
  log(`\n=== ATOM REGISTRY === ${JSON.stringify(byScope)} (${atoms.length} total)`)

  const reach = warnings.filter((w) => w.message.includes('[reachability:'))
  log(`\n=== WARNINGS (${warnings.length}, reachability ${reach.length}) ===`)
  for (const w of warnings) log(`  [stage ${w.stage}/${w.kind ?? 'warning'}] ${String(w.message).slice(0, 220)}`)

  // ---- Structural checks the lint should already guarantee ----
  log(`\n=== CROSS-CHECKS ===`)
  const problems = []
  const nodeKeys = new Set(nodes.map((n) => n.key))
  const registry = new Set(atoms.map((a) => a.slug))
  const canon = (s) => String(s).toLowerCase().replace(/['’]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  for (const n of nodes) {
    const spec = n.encounter_spec ?? {}
    for (const t of n.transitions ?? []) {
      if (t.to_node_key && !nodeKeys.has(t.to_node_key)) problems.push(`${n.key}: dangling -> ${t.to_node_key}`)
    }
    if (!(n.transitions ?? []).some((t) => t.on === 'full')) problems.push(`${n.key}: no full transition`)
    for (const a of [...(spec.on_success ?? []), ...(spec.on_partial ?? []), ...(spec.on_failure ?? [])]) {
      if (!registry.has(canon(a))) problems.push(`${n.key}: off-registry atom "${a}"`)
    }
    if (n.kind === 'social' && ((spec.params ?? {}).npc_ids ?? []).length === 0) {
      problems.push(`${n.key}: social node stages nobody`)
    }
  }
  for (const o of objectives) {
    const routes = nodes.filter((n) => n.objective_id === o.id && n.role === 'route')
    if (routes.length < 2) problems.push(`objective "${o.title}": only ${routes.length} route node(s)`)
  }
  const personalSlugs = new Set(atoms.filter((a) => a.scope === 'personal').map((a) => a.slug))
  for (const n of nodes) {
    const spec = n.encounter_spec ?? {}
    for (const a of [...(spec.on_success ?? []), ...(spec.on_partial ?? []), ...(spec.on_failure ?? [])]) {
      if (personalSlugs.has(canon(a))) problems.push(`${n.key}: credits PERSONAL atom "${a}" (structural leak)`)
    }
  }
  const combat = nodes.filter((n) => n.role === 'route' && n.kind === 'combat').length
  if (combat < 1) problems.push(`no combat node authored (floor is 1)`)
  if (combat > 3) problems.push(`${combat} combat nodes (ceiling is 3)`)

  if (problems.length === 0) log('  clean - no structural problems found')
  else for (const p of problems) log(`  BUG: ${p}`)

  log(`\nadventure_id: ${advId}`)
  log(`total spend: $${(await spentUsd(advId)).toFixed(4)}`)
}

main().catch((err) => { console.error('FAILED:', err.message); process.exit(1) })
