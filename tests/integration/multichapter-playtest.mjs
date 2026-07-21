// PAID multi-chapter playtest - SPENDS REAL OPENROUTER CREDITS (guide generation + play).
// Generates a fresh multi-chapter mystery through the real guide pipeline, then plays it solo
// with deliberately POOR player input: one-word replies, typos, no punctuation, vague verbs,
// questions instead of actions - what real players type, not what the prompts hope for.
//
// It asserts nothing about "correct" answers. It collects evidence about CONSISTENCY (fallback
// lines, blocked drafts, contradiction incidents) and PACING (how many turns the story spends
// circling vs. moving, objective/beat/encounter progression), then prints a report.
//
// Usage: node tests/integration/multichapter-playtest.mjs [--budget 0.60]
import { readFileSync } from 'node:fs'
import { pinTestModels, TEST_MODEL } from './test-model-map.mjs'

function readEnvVar(path, name) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(new RegExp(`^${name}="?(.+?)"?$`, 'm'))
  if (!match) throw new Error(`${name} not found in ${path}`)
  return match[1].trim()
}

const url = readEnvVar('frontend/.env.local', 'VITE_SUPABASE_URL')
const anonKey = readEnvVar('frontend/.env.local', 'VITE_SUPABASE_PUBLISHABLE_KEY')
const serviceKey = readEnvVar('backend/.env', 'SUPABASE_SERVICE_ROLE_KEY')
/** Supports both `--flag value` (separate argv entries) and `--flag=value`. */
function argOf(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  if (i !== -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1]
  const inline = process.argv.find((a) => a.startsWith(`--${name}=`))
  return inline ? inline.slice(name.length + 3) : fallback
}
const BUDGET = Number(argOf('budget', '0.6'))
/** one_shot is the cheap, fast shape - fewer chapters means far fewer pipeline stages. */
const ADVENTURE_TYPE = argOf('type', 'multi_chapter')

/**
 * Every run used the same mining-town murder, so everything we know is about ONE loop type.
 * These premises push the pipeline at different templates - the pillar-starvation guidance,
 * the stall promoter and the ledger are all meant to be loop-agnostic, and only varied
 * premises can show whether they are. `--plot <key>` picks one; default rotates by clock so
 * repeat runs do not silently retest the same story.
 */
const PLOTS = {
  murder: {
    title: 'The Ashfall Inheritance',
    idea: 'In a mountain mining town, the mine owner is found dead the night before he was to ' +
      'sign away the deed. Everyone in the household had reason to want him gone. The party ' +
      'must work out who killed him before the thaw brings the magistrate.',
  },
  heist: {
    title: 'The Tidewater Vault',
    idea: 'A merchant guild keeps its ledgers in a tidal vault that floods twice a day. The ' +
      'party has one low tide to get in, find the manifest that proves the guild is selling ' +
      'conscripts, and get out before the water returns.',
  },
  siege: {
    title: 'The Last Bell of Karrow',
    idea: 'A frontier monastery has three days before a warband arrives. The monks will not ' +
      'abandon their library, the villagers want to flee, and the walls have one breach nobody ' +
      'will admit to. The party must decide what is defended and what is lost.',
  },
  dungeon: {
    title: 'Below the Sunken Chapel',
    idea: 'Floodwater has opened a stair beneath a ruined chapel. Something down there has been ' +
      'taking livestock, and the last party sent to look never came back up. The party goes ' +
      'down to find out what happened to them.',
  },
  escort: {
    title: 'The Long Road to Emberfall',
    idea: 'A witness who can testify against a city magistrate must reach the assizes eight ' +
      'days away. Three factions want them silenced, the witness does not want to go, and the ' +
      'safest road is the one the party cannot afford to take.',
  },
}
const PLOT_KEYS = Object.keys(PLOTS)
const PLOT = PLOTS[argOf('plot', PLOT_KEYS[Math.floor(Date.now() / 1000) % PLOT_KEYS.length])] ?? PLOTS.murder

/**
 * Transient network failures killed two paid runs mid-generation ("fetch failed"), losing the
 * guide spend each time. Retry the TRANSPORT only - an HTTP error response is the caller's
 * business, but a socket that never connected is worth another go.
 */
async function withRetry(label, fn, attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const transient = err instanceof TypeError || /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err?.message ?? err))
      if (!transient) throw err
      const waitMs = 1000 * 2 ** i
      console.log(`  (transient ${label} failure: ${err?.message ?? err} - retry ${i + 1}/${attempts - 1} in ${waitMs}ms)`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
  }
  throw lastError
}

const password = `Test-password-${Date.now()}!`
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
const FALLBACK = 'The attempt is resolved; the outcome stands.'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}
async function deleteUser(id) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin })
}
async function signIn(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign in failed: ${res.status}`)
  return body.access_token
}
async function serviceRest(method, path, payload) {
  return withRetry(`${method} ${path}`, async () => {
    const res = await fetch(`${url}/rest/v1/${path}`, {
      method, headers: { ...admin, Prefer: 'return=representation' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`service ${method} ${path} failed: ${res.status} ${JSON.stringify(body)}`)
    return body
  })
}
async function act(token, payload) {
  return withRetry(`session ${payload.action}`, async () => {
    const res = await fetch(`${url}/functions/v1/session`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  })
}
async function pipeline(token, payload) {
  return withRetry(`pipeline ${payload.action}`, async () => {
    const res = await fetch(`${url}/functions/v1/guide-pipeline`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  })
}

// A REALISTIC mix, not a worst case. Half the turns are what players type when they are
// half-paying-attention (one-word replies, typos, questions instead of actions); the other half
// are what an engaged player types - specific, physical, aimed at whatever is in front of them.
//
// Deliberately GENRE-NEUTRAL: the harness now rotates through murder, heist, siege, dungeon and
// escort premises, so "examine the body for wounds" would be nonsense in four of five. These
// read as competent play in any adventure, and escalate the way real play does - look, ask,
// commit, press, resolve.
const TURNS = [
  'ok',                                                          // poor
  'i look around carefully for anything out of place',           // good
  'who r u',                                                     // poor
  'i ask the people here what they know about this',             // good
  'hm',                                                          // poor
  'i search the area properly for anything useful',              // good
  'yes',                                                         // poor
  'i look for another way in or around',                         // good
  'whats in here',                                               // poor
  'i take a closer look at the thing that seems wrong',          // good
  'i dont know',                                                 // poor
  'i ask about the thing everyone keeps avoiding',               // good
  'is he ok',                                                    // poor - must NOT read as suspicion
  'i press him on what he is not telling us',                    // good
  'i think he is lying',                                         // poor phrasing, real distrust
  'i take what we found and follow where it points',             // good
  'ok fine',                                                     // poor
  'i tell the others what i have worked out',                    // good
  'go on',                                                       // poor
  'i commit to the plan and move on it now',                     // good
  'i search again',                                              // poor
  'i deal with whoever is standing in our way',                  // good
  'help',                                                        // poor
  'i make sure nothing else gets lost or destroyed',             // good
  'i keep going',                                                // poor
  'i finish this properly and see it through',                   // good
]

async function main() {
  const stamp = Date.now()
  const email = `mc-playtest-${stamp}@example.com`
  const userId = await createConfirmedUser(email)
  const token = await signIn(email)
  await pinTestModels(serviceRest, userId)
  console.log(`setup: user ${email} (all agents pinned to ${TEST_MODEL})`)

  // --adventure <id> resumes against an already-generated guide (the pipeline self-chains
  // server-side, so a poller timing out never means the generation was lost).
  const resumeId = argOf('adventure', undefined)
  let advId = resumeId
  if (resumeId) {
    await serviceRest('PATCH', `adventures?id=eq.${resumeId}`, { creator_id: userId })
    console.log(`adventure: ${advId} (resumed, reassigned to this run's user)`)
  } else {
    const [adventure] = await serviceRest('POST', 'adventures', {
      creator_id: userId, mode: 'full_ai', min_players: 1, max_players: 1, type: ADVENTURE_TYPE,
      status: 'draft', demo: false, title: PLOT.title, plot_idea: PLOT.idea,
    })
    advId = adventure.id
    console.log(`adventure: ${advId} (${ADVENTURE_TYPE}) - "${PLOT.title}"`)
  }

  const spentUsd = async () => {
    const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=cost_usd`)
    return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
  }

  // ---- Guide generation (real pipeline, 8 stages) ----
  console.log('\n[guide generation]')
  if (!resumeId) {
    const started = await pipeline(token, { action: 'start', adventure_id: advId })
    if (started.status !== 202) throw new Error(`pipeline start failed: ${JSON.stringify(started)}`)
  }
  let status = 'generating'
  let retries = 0
  const MAX_RETRIES = 4
  // The server's kick is best-effort fire-and-forget, so the CLIENT is the safety net - the
  // real guide page does exactly this (use-guide.ts nudges `run` after 4 unchanged polls).
  // Without it a headless consumer stalls forever on a lost kick or a killed invocation.
  let fingerprint = ''
  let stallPolls = 0
  for (let i = 0; i < 400 && status === 'generating'; i++) {
    await sleep(4000)
    const [row] = await serviceRest('GET', `adventures?id=eq.${advId}&select=status`)
    status = row.status
    const jobs = await serviceRest('GET', `guide_jobs?adventure_id=eq.${advId}&select=id,stage,status,error&order=stage`)
    const failed = jobs.find((j) => j.status === 'failed')
    if (failed) {
      // A stage can fail on a truncated/malformed completion. The product answer is the
      // Retry button, so the playtest presses it rather than throwing away a paid guide.
      if (retries >= MAX_RETRIES) throw new Error(`stage ${failed.stage} failed ${retries}x: ${failed.error}`)
      retries++
      console.log(`  !! stage ${failed.stage} failed (${String(failed.error).slice(0, 100)}) - retry ${retries}/${MAX_RETRIES}`)
      const r = await pipeline(token, { action: 'retry', job_id: failed.id })
      if (r.status !== 202) throw new Error(`retry rejected: ${JSON.stringify(r)}`)
      status = 'generating'
      continue
    }
    const nextFingerprint = jobs.map((j) => `${j.id}:${j.status}`).join('|')
    const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running')
    if (hasPending && nextFingerprint === fingerprint) {
      if (++stallPolls >= 4) {
        stallPolls = 0
        console.log('  (stalled - nudging the runner)')
        await pipeline(token, { action: 'run', adventure_id: advId })
      }
    } else {
      stallPolls = 0
    }
    fingerprint = nextFingerprint

    if (i % 5 === 0) {
      const done = jobs.filter((j) => j.status === 'done').length
      console.log(`  ... ${done}/${jobs.length} stages done (status: ${status}, $${(await spentUsd()).toFixed(4)})`)
    }
  }
  console.log(`  guide status: ${status} after $${(await spentUsd()).toFixed(4)}`)
  if (status !== 'guide_ready') throw new Error(`guide never became ready (${status})`)

  // ---- What the pipeline actually authored (Phase 4 assertions) ----
  const chapters = await serviceRest('GET', `chapters?adventure_id=eq.${advId}&select=id,index,title,arc_summary&order=index`)
  const objectives = await serviceRest('GET', `objectives?adventure_id=eq.${advId}&select=id,chapter_id,index,title,reveal_state&order=index`)
  const endings = await serviceRest('GET', `endings?adventure_id=eq.${advId}&select=id,index,title,tone,trigger_conditions&order=index`)
  const npcs = await serviceRest('GET', `npcs?adventure_id=eq.${advId}&select=id,name,role`)
  const locations = await serviceRest('GET', `locations?adventure_id=eq.${advId}&select=id,name`)
  const ingredients = await serviceRest('GET', `ingredients?adventure_id=eq.${advId}&select=id,type,reveals,placement,discovered`)
  const warnings = await serviceRest('GET', `guide_warnings?adventure_id=eq.${advId}&select=stage,message`)

  console.log(`\n[authored guide]`)
  console.log(`  chapters:   ${chapters.length}`)
  chapters.forEach((c) => console.log(`    ${c.index + 1}. ${c.title}`))
  console.log(`  objectives: ${objectives.length}`)
  objectives.forEach((o) => console.log(`    - ${o.title} [${o.reveal_state}]`))
  console.log(`  endings:    ${endings.length}`)
  const objIds = new Set(objectives.map((o) => o.id))
  const finalObjId = objectives[objectives.length - 1]?.id
  let endingsWithObjective = 0
  let endingsCitingFinal = 0
  endings.forEach((e) => {
    const sigs = (e.trigger_conditions?.signals ?? [])
    const refs = sigs.map((s) => s.when?.objective_id).filter((x) => x && objIds.has(x))
    if (refs.length > 0) endingsWithObjective++
    if (refs.includes(finalObjId)) endingsCitingFinal++
    console.log(`    - ${e.title} (${e.tone}) objective-signals: ${refs.length}`)
  })
  console.log(`  npcs: ${npcs.length}, locations: ${locations.length}, ingredients: ${ingredients.length}`)
  const locPlaced = ingredients.filter((i) => i.placement?.location_id)
  const npcPlaced = ingredients.filter((i) => i.placement?.npc_id)
  console.log(`  ingredient placement: ${locPlaced.length} at locations, ${npcPlaced.length} on NPCs`)
  console.log(`  guide warnings: ${warnings.length}`)
  warnings.forEach((w) => console.log(`    [stage ${w.stage}] ${w.message}`))

  // ---- Play ----
  const [char] = await serviceRest('POST', 'characters', {
    user_id: userId, name: 'Bram', level: 1, is_complete: true,
    abilities: { str: 12, dex: 14, con: 12, int: 14, wis: 14, cha: 10 },
    skill_proficiencies: ['investigation', 'perception', 'insight'], hp_max: 10, hp_current: 10,
  })
  await act(token, { action: 'activate', adventure_id: advId })
  await act(token, { action: 'pick_character', adventure_id: advId, character_id: char.id })
  await act(token, { action: 'ready', adventure_id: advId, ready: true })
  const sessionStart = await act(token, { action: 'start_session', adventure_id: advId })
  if (sessionStart.status !== 200) throw new Error(`session start failed: ${JSON.stringify(sessionStart.body)}`)
  console.log(`\n[play] session started ($${(await spentUsd()).toFixed(4)})`)

  const turnLog = []
  for (let i = 0; i < TURNS.length; i++) {
    const spent = await spentUsd()
    if (spent > BUDGET) {
      console.log(`  !! budget guard at $${spent.toFixed(4)} after ${i} turns - stopping play`)
      break
    }
    const text = TURNS[i]
    const before = await act(token, { action: 'resync', adventure_id: advId })
    const linesBefore = before.body.state?.dialogue?.lines?.length ?? 0
    const res = await act(token, { action: 'player_intent', adventure_id: advId, kind: 'say', text })
    const resolved = res.body?.resolved ?? res.body?.error ?? res.status
    turnLog.push({ i: i + 1, text, resolved, status: res.status })
    console.log(`  ${String(i + 1).padStart(2)}. "${text}" -> ${resolved}${res.status !== 200 ? ` (${res.status})` : ''}`)

    // A pending check with nobody else at the table: roll it, or the next turn 409s.
    const mid = (await act(token, { action: 'resync', adventure_id: advId })).body.state
    if (mid?.dialogue?.pending?.id) {
      const r = await act(token, { action: 'roll_pending', adventure_id: advId, prompt_id: mid.dialogue.pending.id })
      turnLog[turnLog.length - 1].rolled = r.body?.resolved ?? r.status
    }
    const after = (await act(token, { action: 'resync', adventure_id: advId })).body.state
    turnLog[turnLog.length - 1].newLines = (after?.dialogue?.lines?.length ?? 0) - linesBefore
  }

  // ---- Evidence ----
  const events = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&select=id,type,payload&order=id`)
  const state = (await act(token, { action: 'resync', adventure_id: advId })).body.state
  const lines = state?.dialogue?.lines ?? []
  const byType = {}
  events.forEach((e) => { byType[e.type] = (byType[e.type] ?? 0) + 1 })

  console.log('\n========== ANALYSIS ==========')
  console.log('\n[consistency]')
  const incidents = events.filter((e) => e.type === 'incident')
  const doubleFail = incidents.filter((e) => e.payload?.kind === 'consistency_double_failure')
  const fallbacks = lines.filter((l) => l.text === FALLBACK)
  console.log(`  consistency_blocked (recovered by regen): ${byType.consistency_blocked ?? 0}`)
  console.log(`  consistency double-failures:              ${doubleFail.length}`)
  console.log(`  mechanical fallback lines:                ${fallbacks.length}`)
  console.log(`  incidents (all kinds):                    ${incidents.length}`)
  incidents.forEach((e) => console.log(`    - ${JSON.stringify(e.payload).slice(0, 160)}`))
  const errored = turnLog.filter((t) => t.status !== 200)
  console.log(`  turns that errored:                       ${errored.length}${errored.length ? ` (${errored.map((t) => t.status).join(',')})` : ''}`)
  const silent = turnLog.filter((t) => t.newLines === 0)
  console.log(`  turns that produced NO new line:          ${silent.length}${silent.length ? ` -> ${silent.map((t) => `"${t.text}"`).join(', ')}` : ''}`)

  console.log('\n[pacing]')
  const counts = (...types) => types.reduce((s, t) => s + (byType[t] ?? 0), 0)
  const entryKinds = {}
  events.filter((e) => e.type === 'entry_mapped').forEach((e) => {
    entryKinds[e.payload?.entry] = (entryKinds[e.payload?.entry] ?? 0) + 1
  })
  console.log(`  turns played:                ${turnLog.length}`)
  console.log(`  entry mapping:               ${JSON.stringify(entryKinds)}`)
  console.log(`  encounters opened/resolved:  ${counts('encounter_opened')}/${counts('encounter_resolved')}`)
  console.log(`  checks prompted/rolled:      ${counts('check_prompted')}/${counts('check_rolled')}`)
  console.log(`  objectives completed:        ${counts('objective_completed')}`)
  console.log(`  beats opened / exits met:    ${counts('beat_opened')}/${counts('beat_exit_met')}`)
  console.log(`  idle nudges / auto hints:    ${counts('idle_nudge')}/${events.filter((e) => e.type === 'hint_given').length}`)
  const beatKinds = {}
  events.filter((e) => e.type === 'beat_opened').forEach((e) => {
    const k = e.payload?.encounter_kind ?? 'none'
    beatKinds[k] = (beatKinds[k] ?? 0) + 1
  })
  console.log(`  beat encounter kinds:        ${JSON.stringify(beatKinds)}`)
  const promotions = events.filter((e) => e.type === 'stall_promoted')
  console.log(`  stall promotions:            ${promotions.length}`)
  promotions.forEach((e) => console.log(`    ${e.payload?.action}: ${e.payload?.label ?? (e.payload?.npcs ?? []).join(', ')} - ${e.payload?.why ?? ''}`))
  const ledgers = events.filter((e) => e.type === 'scene_ledger')
  const proposed = ledgers.reduce((n, e) => n + (e.payload?.proposed?.length ?? 0), 0)
  const applied = ledgers.reduce((n, e) => n + (e.payload?.applied?.length ?? 0), 0)
  console.log(`  scene ledgers: ${ledgers.length} (milestones proposed ${proposed}, applied ${applied})`)
  ledgers.forEach((e) => console.log(`    [${e.payload?.phase}] ${e.payload?.label}: ${e.payload?.digest ?? ''}`))
  const objDone = events.filter((e) => e.type === 'objective_completed')
  objDone.forEach((e) => console.log(`    completed: ${e.payload?.title}`))

  console.log('\n[new systems under test]')
  console.log(`  ingredient_revealed:   ${counts('ingredient_revealed')}`)
  events.filter((e) => e.type === 'ingredient_revealed')
    .forEach((e) => console.log(`    - source=${e.payload?.source ?? 'npc'} ${e.payload?.ingredient_id}`))
  console.log(`  location clues found:  ${events.filter((e) => e.type === 'ingredient_revealed' && e.payload?.source === 'location_search').length} of ${locPlaced.length} placed`)
  // Discovery can only fire where the party actually stands. If they never travel, clues in
  // other rooms are unreachable by design, not by bug - record which is which.
  const sceneLoc = state?.scene?.locationId ?? null
  const reachable = locPlaced.filter((i) => i.placement?.location_id === sceneLoc).length
  const travels = events.filter((e) => e.type === 'scene_travel').length
  console.log(`    party ended at ${state?.scene?.locationName || 'nowhere'} (${sceneLoc ?? 'no location'})`)
  console.log(`    clues reachable there: ${reachable}; scene_travel events: ${travels}; locations in guide: ${locations.length}`)
  console.log(`  disposition_changed:   ${counts('disposition_changed')}`)
  console.log(`  suspicion_noted:       ${counts('suspicion_noted')}`)
  events.filter((e) => e.type === 'suspicion_noted').forEach((e) => console.log(`    - ${e.payload?.name} (tally ${e.payload?.tally})`))
  console.log(`  dial nudges:           ${counts('dial_nudged')} (judged by the scene ledger)`)
  events.filter((e) => e.type === 'dial_nudged').forEach((e) => console.log(`    - ${e.payload?.dial} ${e.payload?.from}->${e.payload?.to}: ${e.payload?.why}`))
  console.log(`  ending commitments:    ${counts('ending_committed')} (must be 0 mid-story)`)
  console.log(`  social_started:        ${counts('social_started')}`)

  console.log('\n[repetition check - narrator circling]')
  const narration = lines.filter((l) => !l.speaker).map((l) => l.text)
  const opener = (t) => t.slice(0, 60).toLowerCase()
  const seen = new Map()
  narration.forEach((t) => seen.set(opener(t), (seen.get(opener(t)) ?? 0) + 1))
  const repeats = [...seen.entries()].filter(([, n]) => n > 1)
  console.log(`  narration lines: ${narration.length}, repeated openings: ${repeats.length}`)
  repeats.forEach(([t, n]) => console.log(`    x${n}: "${t}..."`))

  console.log('\n[full transcript]')
  lines.forEach((l) => console.log(`  ${l.speaker ?? '<narrator>'}: ${l.text}`))

  console.log('\n[guide summary for review]')
  console.log(`  endings with >=1 objective signal: ${endingsWithObjective}/${endings.length}`)
  console.log(`  endings citing the FINAL objective: ${endingsCitingFinal}`)

  const total = await spentUsd()
  const usage = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=agent_role,cost_usd`)
  const byRole = {}
  usage.forEach((u) => {
    byRole[u.agent_role] = byRole[u.agent_role] ?? { n: 0, cost: 0 }
    byRole[u.agent_role].n++
    byRole[u.agent_role].cost += Number(u.cost_usd) || 0
  })
  console.log('\n[spend]')
  Object.entries(byRole).sort((a, b) => b[1].cost - a[1].cost)
    .forEach(([role, v]) => console.log(`  ${role}: ${v.n} calls, $${v.cost.toFixed(4)}`))
  console.log(`  TOTAL: $${total.toFixed(4)}`)

  await serviceRest('DELETE', `adventures?id=eq.${advId}`)
  await serviceRest('DELETE', `characters?id=eq.${char.id}`)
  await deleteUser(userId)
  console.log('\ncleanup complete')
}

main().catch(async (err) => {
  console.error('\nPLAYTEST ERROR:', err.message)
  process.exitCode = 1
})
