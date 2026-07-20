// PAID live test for the Scene Director slice (2026-07-19) - SPENDS REAL OPENROUTER CREDITS
// (~$0.05 per run). Run manually, never in CI.
//
// Verifies with real models: (1) say with no NPC staged is adjudicated (the DM answers - the
// old route was silence), (2) travel declarations move scene.locationName via the Adjudicator's
// scene_effects, (3) a hand-seeded skill challenge driven through attempts to a tiered
// resolution (encounter-states Slice 2), (4) the idle-nudge escalation ladder: nudge -> world
// stirs (antagonist turn) -> wait on players, re-armed only by player activity.
// Spend-guarded at $0.80.
//
// Usage: node tests/integration/scene-director-live.mjs
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
const password = `Test-password-${Date.now()}!`
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
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
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method, headers: { ...admin, Prefer: 'return=representation' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`service ${method} ${path} failed: ${res.status} ${JSON.stringify(body)}`)
  return body
}
async function act(token, payload) {
  const res = await fetch(`${url}/functions/v1/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const stamp = Date.now()
const email = `scenedir-gm-${stamp}@example.com`
let userId = null
let pass = 0
let fail = 0
function ok(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok: ${label}`) }
  else { fail++; console.log(`  FAIL: ${label}${detail ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`) }
}
function note(label, value) {
  console.log(`  note: ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

async function main() {
  userId = await createConfirmedUser(email)
  const gm = await signIn(email)
  await pinTestModels(serviceRest, userId)
  console.log('setup: user created')

  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userId, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'A coastal lighthouse has gone dark and ships are wrecking on the reefs.',
    status: 'guide_ready', demo: false, title: 'Scene Director Live Probe',
    meta_loop: { premise: 'Greywater\'s lighthouse went dark a week ago; the keeper is missing.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'The Dark Lantern', arc_summary: 'Find the keeper, relight the lantern.', status: 'active',
  })
  await serviceRest('POST', 'locations', [
    {
      adventure_id: advId, chapter_id: chapter.id, name: 'The Salt-Wound Quay',
      description: 'A storm-bitten fishing harbor beneath the cliffs.',
    },
    {
      adventure_id: advId, chapter_id: chapter.id, name: 'The Dark Lighthouse',
      description: 'The lightless tower on the cliff top, door ajar to the wind.',
    },
  ])
  const [objective] = await serviceRest('POST', 'objectives', {
    adventure_id: advId, chapter_id: chapter.id, index: 0, title: 'Relight the Greywater lantern',
    hidden_description: 'The keeper was dragged into the sea-caves by wreckers.',
    reveal_state: 'hidden',
    completion_predicates: { all: [{ flag: 'lantern_relit', eq: true }] },
  })
  const [sereth] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Harbormistress Sereth Vane', role: 'npc',
    personality: { summary: 'iron-spined, guilt-ridden' },
    description: 'Greywater\'s harbormistress.', faction: 'greywater',
  })
  await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Mordekai', role: 'npc',
    personality: { summary: 'retired smuggler, superstitious' },
    description: 'An old smuggler who drinks at the quay and knows the sea-caves.', faction: 'greywater',
  })
  await serviceRest('POST', 'quest_contracts', {
    adventure_id: advId, chapter_id: chapter.id, label: 'Relight the Greywater lantern',
    giver_npc_id: sereth.id, is_entry: true,
    reward: { gold_floor: 60, gold_ceiling: 120, extras: [] },
    stakes: 'Every dark night claims another ship.',
    objective_ids: [objective.id],
  })
  const [gmChar] = await serviceRest('POST', 'characters', {
    user_id: userId, name: 'Kestrel', level: 1, is_complete: true,
    abilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 16 },
    skill_proficiencies: ['persuasion', 'stealth', 'athletics'], hp_max: 10, hp_current: 10,
  })

  const spentUsd = async () => {
    const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=cost_usd`)
    return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
  }
  const overBudget = async () => {
    const spent = await spentUsd()
    if (spent > 0.8) { console.log(`  !! spend guard tripped at $${spent.toFixed(4)}`); return true }
    return false
  }
  const resyncState = async () => (await act(gm, { action: 'resync', adventure_id: advId })).body.state
  const clearPending = async () => {
    const state = await resyncState()
    if (state.dialogue.pending) {
      await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: state.dialogue.pending.id })
    }
  }

  console.log('\n[session start + offer acceptance]')
  await act(gm, { action: 'activate', adventure_id: advId })
  await act(gm, { action: 'pick_character', adventure_id: advId, character_id: gmChar.id })
  await act(gm, { action: 'ready', adventure_id: advId, ready: true })
  let started = await act(gm, { action: 'start_session', adventure_id: advId })
  if (started.status !== 200) {
    // The session-start agent chain occasionally hits WORKER_RESOURCE_LIMIT - one retry.
    note('session start failed once - retrying', started.body)
    await sleep(3000)
    started = await act(gm, { action: 'start_session', adventure_id: advId })
    if (started.status === 409) started = { status: 200, body: { retried: 'already active' } }
  }
  ok('session starts', started.status === 200, started.body)
  const accept = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We accept the job. We will relight your lantern.' })
  ok('offer accepted', accept.status === 200 && accept.body.resolved === 'offer_accepted', accept.body)

  console.log('\n[travel via say -> adjudicator scene_effects]')
  if (!(await overBudget())) {
    const travel = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We take the cliff road up to the Dark Lighthouse.' })
    ok('travel say is adjudicated, not silent chat', travel.status === 200 && travel.body.resolved !== 'chat', travel.body)
    note('travel resolved as', `${travel.body.resolved}${travel.body.next ? ` (next: ${travel.body.next})` : ''}`)
    await clearPending()
    const state = await resyncState()
    ok('scene.locationName moved to The Dark Lighthouse', state.scene.locationName === 'The Dark Lighthouse', state.scene)
    const travelEvents = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.scene_travel&select=payload`)
    ok('scene_travel event logged', travelEvents.length >= 1, travelEvents)
    note('arrival narration', state.dialogue.lines.at(-1)?.text)
  }

  console.log('\n[npc staging via say]')
  if (!(await overBudget())) {
    // The machine may still have an open encounter from the travel entry - close the loop
    // on any pending check first so the say routes cleanly.
    await clearPending()
    const seek = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We head back down to the Salt-Wound Quay and find Mordekai - I want to ask him about the sea-caves.' })
    ok('seek-npc say processed', seek.status === 200, seek.body)
    note('seek resolved as', seek.body.resolved)
    await clearPending()
    const state = await resyncState()
    note('scene mode / location', `${state.scene.mode} / ${state.scene.locationName}`)
    note('staged speakers', state.dialogue.speakers.map((s) => s.name))
    if (state.dialogue.speakers.length > 0) {
      ok('adjudicator staged NPC(s) into a live scene', true)
      // Hand-back contract probe: a staged-NPC reply should end inviting a response.
      const reply = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Tell me plainly, Mordekai - who took the keeper?' })
      note('npc say resolved as', reply.body.resolved)
      if (reply.body.resolved === 'check_prompted') await clearPending()
      const convo = await resyncState()
      const npcLine = [...convo.dialogue.lines].reverse().find((l) => l.npcId)
      ok('staged NPC replied in character', Boolean(npcLine), convo.dialogue.lines.slice(-2))
      note('npc reply (should END handing the scene back)', npcLine?.text)
    } else {
      note('no staging this run (LLM judgment call - travel/mark may still have applied)', '')
    }
    note('latest line', state.dialogue.lines.at(-1)?.text)
  }

  console.log('\n[combat placeholder via do]')
  if (!(await overBudget())) {
    await clearPending()
    const fight = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'Wreckers rush us from behind the bollards - I draw my blades and attack them head-on.' })
    ok('attack intent adjudicated', fight.status === 200, fight.body)
    note('attack resolved as', fight.body.resolved)
    await clearPending()
    const encounters = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.encounter_resolved&select=payload`)
    const combat = encounters.find((e) => e.payload.kind === 'combat')
    if (combat) {
      ok('placeholder combat auto-resolved as a victory', combat.payload.victory === true || combat.payload.tier === 'full', combat.payload)
      const combatState = await resyncState()
      note('combat marker line', combatState.dialogue.lines.find((l) => l.text.startsWith('Combat:'))?.text)
      note('aftermath narration', combatState.dialogue.lines.at(-1)?.text)
    } else {
      note('no combat encounter this run (LLM judgment call)', '')
    }
  }

  console.log('\n[skill challenge: drive the open (or seeded) encounter to resolution (Slice 2)]')
  if (!(await overBudget())) {
    await clearPending()
    let state = await resyncState()
    let seeded = false
    if (state.encounter) {
      // The machine already entered an encounter organically (entry mapping) - drive that one.
      note('driving the organically opened encounter', state.encounter.label)
      ok('challenge available to drive', state.encounter.kind === 'skill_challenge', state.encounter)
    } else {
      const open = await act(gm, {
        action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'open_encounter',
        encounter_kind: 'skill_challenge', label: 'Scale the lightless tower',
        stakes: 'A fall onto the rocks - and the lantern stays dark',
        needed_successes: 2, max_failures: 2, suggested_skills: ['athletics', 'stealth'],
        on_success: ['lantern_relit'], on_partial: ['lantern_relit'], on_failure: [],
      })
      ok('challenge available to drive', open.status === 200 && Boolean(open.body.encounter_id), open.body)
      seeded = true
    }
    state = await resyncState()
    ok('visible frame is live (kind + progress)',
      state.encounter?.kind === 'skill_challenge' && typeof state.encounter?.progress?.neededSuccesses === 'number',
      state.encounter)

    const attempts = [
      'I climb the outer wall, finding handholds in the salt-cracked stone.',
      'I brace the rusted gallery door and force it open for the others.',
      'I haul myself over the gallery rail toward the lantern room.',
      'I wedge my dagger into the seam and pull myself up the last stretch.',
      'I make a final push for the lantern room, whatever it costs.',
    ]
    for (let i = 0; i < 12; i++) {
      state = await resyncState()
      if (!state.encounter) break
      if (await overBudget()) break
      if (state.dialogue.pending) {
        await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: state.dialogue.pending.id })
        continue
      }
      const attempt = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: attempts[i % attempts.length] })
      note('attempt resolved as', attempt.body.resolved ?? JSON.stringify(attempt.body).slice(0, 120))
    }
    state = await resyncState()
    ok('challenge closed after attempts', !state.encounter, state.encounter)
    const attemptsLogged = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.encounter_attempt&select=payload`)
    ok('encounter_attempt events logged', attemptsLogged.length >= 1, attemptsLogged.length)
    const resolved = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.encounter_resolved&select=payload&order=id.desc`)
    const challengeResolution = resolved.find((e) => e.payload.kind === 'skill_challenge')
    ok('encounter_resolved carries a tier', ['full', 'partial', 'failed'].includes(challengeResolution?.payload?.tier), challengeResolution)
    note('resolution tier', challengeResolution?.payload?.tier)
    if (seeded && challengeResolution && challengeResolution.payload.tier !== 'failed') {
      const flags = (await resyncState()).dm?.facts?.flags ?? {}
      ok('outcome map applied lantern_relit on success tiers', flags.lantern_relit === true, flags)
    }
    note('resolution narration', (await resyncState()).dialogue.lines.at(-1)?.text)
  }

  console.log('\n[puzzle: seed -> attempts -> resolution (encounter-states Slice 5)]')
  if (!(await overBudget())) {
    await clearPending()
    const preState = await resyncState()
    if (preState.encounter) {
      note('an encounter is still open - resolving pending work before the puzzle', preState.encounter.label)
      await clearPending()
    }
    const openPuzzle = await act(gm, {
      action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'open_encounter',
      encounter_kind: 'puzzle', label: 'The Lantern Lock',
      stakes: 'The lamp room stays sealed',
      solution: 'Turn the three tide dials to match the carved moons - crescent, then half, then full',
      steps: [
        { description: 'Realize the dials depict tides and moons', hint: 'Salt crust marks three worn rings.' },
        { description: 'Find the carved moon sequence on the lintel', hint: 'Faint carvings above the door catch the light.' },
      ],
      max_attempts: 3,
      fail_consequence: { kind: 'antagonist_step', params: {} },
    })
    ok('puzzle seeds via dm_command', openPuzzle.status === 200, openPuzzle.body)
    let pState = await resyncState(gm, advId)
    ok('scene mode flips to puzzle', pState.scene.mode === 'puzzle', pState.scene.mode)
    ok('puzzle frame visible with step progress', pState.encounter?.kind === 'puzzle' && pState.encounter?.progress?.stepsTotal === 2, pState.encounter)
    const puzzleAttempts = [
      'I study the three dials closely - the rings and salt marks must mean something.',
      'I search the doorframe and lintel for any carved sequence that might order the dials.',
      'I turn the tide dials to match the carved moons: crescent first, then half, then full.',
      'I set the dials again exactly as the lintel shows: crescent, half, full.',
      'One more time, precisely: crescent, then half, then full moon on the three dials.',
    ]
    for (const text of puzzleAttempts) {
      pState = await resyncState(gm, advId)
      if (!pState.encounter) break
      if (await overBudget()) break
      const attempt = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text })
      note('puzzle attempt resolved as', `${attempt.body.resolved ?? attempt.status} ${attempt.body.result ?? ''}`)
    }
    pState = await resyncState(gm, advId)
    ok('puzzle closed (solved or consequence fired)', !pState.encounter, pState.encounter)
    ok('scene mode restored after the puzzle', pState.scene.mode !== 'puzzle', pState.scene.mode)
    const puzzleResolved = (await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.encounter_resolved&select=payload&order=id.desc`))
      .find((e) => e.payload.kind === 'puzzle')
    ok('puzzle resolution logged with a tier', ['full', 'partial', 'failed'].includes(puzzleResolved?.payload?.tier), puzzleResolved)
    note('puzzle tier', puzzleResolved?.payload?.tier)
    note('resolution narration', pState.dialogue.lines.at(-1)?.text)
  }

  console.log('\n[idle nudge escalation ladder]')
  if (!(await overBudget())) {
    await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_auto', nudge_minutes: 1 })
    await clearPending()
    console.log('  (waiting 65s for idle...)')
    await sleep(65000)
    const nudge1 = await act(gm, { action: 'idle_nudge', adventure_id: advId })
    ok('rung 1: gentle nudge fires after silence', nudge1.status === 200 && nudge1.body.resolved === 'nudged', nudge1.body)
    console.log('  (waiting 65s with NO player activity...)')
    await sleep(65000)
    const nudge2 = await act(gm, { action: 'idle_nudge', adventure_id: advId })
    ok('rung 2: continued silence escalates - the world stirs', nudge2.status === 200 && nudge2.body.resolved === 'escalated', nudge2.body)
    const antagonist = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.antagonist_advanced&select=payload`)
    ok('antagonist turn ran on escalation', antagonist.some((e) => e.payload.trigger === 'idle_escalation'), antagonist)
    const escState = await resyncState()
    note('world-stirs narration', escState.dialogue.lines.at(-1)?.text)
    console.log('  (waiting 65s with NO player activity...)')
    await sleep(65000)
    const nudge3 = await act(gm, { action: 'idle_nudge', adventure_id: advId })
    ok('rung 3: table now waits on the players', nudge3.status === 409 && String(nudge3.body.error).includes('Already nudged'), nudge3.body)
    const rearm = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'roll', skill: 'athletics' })
    ok('player activity re-arms the ladder', rearm.status === 200, rearm.body)
    console.log('  (waiting 65s for idle again...)')
    await sleep(65000)
    const nudge4 = await act(gm, { action: 'idle_nudge', adventure_id: advId })
    ok('ladder restarts at a gentle nudge', nudge4.status === 200 && nudge4.body.resolved === 'nudged', nudge4.body)
  }

  console.log('\n[transcript]')
  const state = await resyncState()
  for (const l of state.dialogue.lines) console.log(`  ${l.speaker ?? '<narrator>'}: ${l.text}`)

  const usage = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=agent_role,cost_usd`)
  const byRole = {}
  for (const u of usage) {
    byRole[u.agent_role] = byRole[u.agent_role] ?? { calls: 0, cost: 0 }
    byRole[u.agent_role].calls++
    byRole[u.agent_role].cost += Number(u.cost_usd) || 0
  }
  console.log('\n[spend]')
  for (const [role, s] of Object.entries(byRole)) console.log(`  ${role}: ${s.calls} calls, $${s.cost.toFixed(4)}`)
  console.log(`  TOTAL: ${usage.length} calls, $${(await spentUsd()).toFixed(4)}`)

  console.log(`\n${fail === 0 ? 'PASS' : 'FAILED'} (${pass} ok, ${fail} failed)`)

  await serviceRest('DELETE', `adventures?id=eq.${advId}`)
  await serviceRest('DELETE', `characters?id=eq.${gmChar.id}`)
  await deleteUser(userId)
  console.log('cleanup complete')
  if (fail > 0) process.exitCode = 1
}

main().catch(async (err) => {
  console.error('\nFAILED:', err.message ?? err)
  if (userId) await deleteUser(userId).catch(() => {})
  process.exitCode = 1
})
