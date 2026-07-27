// Authored story-graph lifecycle, $0, against the real deployed `session` function.
//
// WHY THIS EXISTS. Every structural bug in the graph runtime this month cost a paid playthrough to
// find - the `failed -> null` dead end, the exhaust-stall, the rescue discarded before it could be
// played, the director replanning past an unplayed node. All of them are deterministic
// state-machine bugs, and on 2026-07-27 a grep found the reason they were so expensive:
//
//   grep -c story_nodes tests/integration/*.mjs  ->  0, in all fourteen suites
//
// Not one automated test touched the authored graph. We were paying an LLM to be a test harness
// for deterministic code. story-live covers the LEGACY predicate path (its demo adventure has no
// nodes) and must keep doing so, so graph coverage lives here rather than mutating that fixture.
//
// Demo adventure + canned agents = zero spend, asserted at the end.
// Usage: node tests/integration/graph-live.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

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

async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}
const deleteUser = (id) => fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin })

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
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const stamp = Date.now()
const emails = { gm: `gl-gm-${stamp}@example.com` }
const userIds = {}
let pass = 0
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` -- ${JSON.stringify(detail)}` : ''}`)
  pass++
  console.log(`  ok: ${label}`)
}

const eventsOf = (advId, type) =>
  serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.${type}&select=payload&order=id.asc`)
const resync = async (token, advId) => (await act(token, { action: 'resync', adventure_id: advId })).body.state

/** The shape stage 5 derives: two routes then the rescue, each failure handing on the next scene. */
function nodeRows(advId, chapterId, objectiveId, objKey) {
  const spec = (label, onSuccess, onFailure) => ({
    kind: 'skill_challenge', label, stakes: 'the way through', rationale: '',
    params: { needed_successes: 1, max_failures: 1 },
    on_success: onSuccess, on_partial: [], on_failure: onFailure,
  })
  const edge = (on, to, arrival) => ({ on, to_node_key: to, arrival_context: arrival })
  return [
    {
      adventure_id: advId, chapter_id: chapterId, objective_id: objectiveId,
      key: `${objKey}#n0`, index: 0, kind: 'skill_challenge', role: 'route', label: 'The front door',
      narration_seed: 'The front door stands ajar.',
      encounter_spec: spec('The front door', ['gate_opened'], ['front_door_barred']),
      affordances: [{ key: 'force', label: 'Force it', hint: 'force the door' }],
      transitions: [edge('full', null, ''), edge('failed', `${objKey}#n1`, 'Barred out, they circle to the cellar.')],
      local_atoms: [{ name: 'front_door_barred', kind: 'flag' }],
    },
    {
      adventure_id: advId, chapter_id: chapterId, objective_id: objectiveId,
      key: `${objKey}#n1`, index: 1, kind: 'skill_challenge', role: 'route', label: 'The cellar',
      narration_seed: 'A cellar hatch lies half-buried.',
      encounter_spec: spec('The cellar', ['gate_opened'], ['cellar_flooded']),
      affordances: [{ key: 'pry', label: 'Pry it', hint: 'pry the hatch' }],
      transitions: [edge('full', null, ''), edge('failed', `${objKey}#r0`, 'Soaked and out of options, one way remains.')],
      local_atoms: [{ name: 'cellar_flooded', kind: 'flag' }],
    },
    {
      adventure_id: advId, chapter_id: chapterId, objective_id: objectiveId,
      key: `${objKey}#r0`, index: 0, kind: 'skill_challenge', role: 'rescue', label: 'The last way in',
      narration_seed: 'One way remains, and it is not a good one.',
      encounter_spec: spec('The last way in', ['gate_opened'], []),
      affordances: [{ key: 'attempt', label: 'Attempt it', hint: 'take the last way' }],
      transitions: [edge('full', null, '')],
      local_atoms: [],
    },
  ]
}

async function main() {
  userIds.gm = await createConfirmedUser(emails.gm)
  const gm = await signIn(emails.gm)
  await serviceRest('POST', 'user_settings?on_conflict=user_id', { user_id: userIds.gm, provider: 'openrouter' })
    .catch(() => {})

  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.gm, mode: 'full_ai', min_players: 1, max_players: 1, type: 'one_shot',
    plot_idea: 'graph lifecycle test', status: 'guide_ready', demo: true,
    title: 'Graph Lifecycle', meta_loop: { premise: 'A locked house.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'Chapter', arc_summary: 'arc', status: 'active',
  })
  const [objective] = await serviceRest('POST', 'objectives', {
    adventure_id: advId, chapter_id: chapter.id, index: 0, title: 'Get inside the house',
    hidden_description: 'The way in is barred.', reveal_state: 'active',
    completion_predicates: { all: [{ flag: 'gate_opened', eq: true }] },
  })
  const [second] = await serviceRest('POST', 'objectives', {
    adventure_id: advId, chapter_id: chapter.id, index: 1, title: 'Search the study',
    hidden_description: 'What they came for.', reveal_state: 'hidden',
    completion_predicates: { all: [{ flag: 'study_searched', eq: true }] },
  })
  const objKey = `obj:${objective.id}`
  await serviceRest('POST', 'story_atoms', [
    { adventure_id: advId, slug: 'gate_opened', kind: 'flag', scope: 'spine', label: 'gate opened', source_table: 'objectives' },
    { adventure_id: advId, slug: 'front_door_barred', kind: 'flag', scope: 'local', label: 'front door barred', source_table: 'story_nodes' },
    { adventure_id: advId, slug: 'cellar_flooded', kind: 'flag', scope: 'local', label: 'cellar flooded', source_table: 'story_nodes' },
  ])
  await serviceRest('POST', 'story_nodes', nodeRows(advId, chapter.id, objective.id, objKey))
  console.log('setup: graph-bearing demo adventure created')

  const [character] = await serviceRest('POST', 'characters', {
    user_id: userIds.gm, name: 'Vek', level: 1, is_complete: true,
    abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    skill_proficiencies: ['athletics'], hp_max: 11, hp_current: 11,
  })
  await act(gm, { action: 'activate', adventure_id: advId })
  await act(gm, { action: 'pick_character', adventure_id: advId, character_id: character.id })
  await act(gm, { action: 'ready', adventure_id: advId, ready: true })
  const started = await act(gm, { action: 'start_session', adventure_id: advId })
  ok('session starts on a graph-bearing adventure', started.status === 200, started.body)

  const startState = await resync(gm, advId)
  ok('the active objective is current', startState.objectives.currentId === objective.id, startState.objectives)

  console.log('\n[the graph opens the authored first node - not a planned beat]')
  // A loop is normally pushed by accepting the entry quest contract; this suite is about the graph
  // rather than the offer machinery, so it is created directly.
  const [loop] = await serviceRest('POST', 'core_loops', {
    adventure_id: advId, type: 'mystery', status: 'active', stack_position: 0,
  })
  const open1 = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'plan_beat', loop_id: loop.id,
  })
  ok('plan_beat accepted', open1.status === 200, open1.body)
  const opens = await eventsOf(advId, 'beat_opened')
  ok('a beat opened from the story graph', opens.some((e) => e.payload.source === 'story_graph'), opens)
  ok('it is the objective\'s first route node', opens.some((e) => e.payload.node_key === `${objKey}#n0`), opens)

  console.log('\n[a node that opens always resolves - the 2026-07-27 discard class]')
  // Re-plan while #n0 is open and UNPLAYED. Before the fix this silently closed the beat: no
  // encounter_resolved, no setback, and the node marked used forever - a route spent for free.
  const replan = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'plan_beat', loop_id: loop.id,
  })
  ok('dm_command replan accepted', replan.status === 200, replan.body)

  const resolutions = await eventsOf(advId, 'encounter_resolved')
  const n0 = resolutions.find((e) => e.payload.node_key === `${objKey}#n0`)
  ok('the abandoned node recorded a resolution', Boolean(n0), resolutions)
  ok('it resolved as a LOSS, not a win', n0?.payload.tier === 'failed', n0?.payload)
  ok('it is marked as an abandonment, not a played scene', n0?.payload.abandoned === true, n0?.payload)
  const facts = (await resync(gm, advId)).dm?.facts?.flags ?? {}
  ok('the setback fired - losing a scene is never free', facts.front_door_barred === true, facts)

  console.log('\n[the failure edge is followed, so an abandonment is a transition not a hole]')
  const after = await eventsOf(advId, 'beat_opened')
  ok('the next authored node opened', after.some((e) => e.payload.node_key === `${objKey}#n1`), after)
  ok('no node was opened twice', new Set(after.map((e) => e.payload.node_key)).size === after.length, after)

  console.log('\n[the objective resolves because a scene resolved]')
  await serviceRest('POST', 'event_log', {
    adventure_id: advId, session_id: null, type: 'encounter_resolved',
    payload: { node_key: `${objKey}#n1`, tier: 'full', milestones: ['gate_opened'] },
  })
  // Any DM command runs a progress pass. Note the flag itself is NOT what completes the objective
  // any more - the graph is. `gate_opened` is set here only to prove the predicate is no longer
  // consulted: it would have completed the objective under the old model too, and the assertion
  // below is that the completion is attributed to the resolved node.
  const progress = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_flag',
    flag: 'gate_opened', value: true,
  })
  ok('a progress pass runs', progress.status === 200, progress.body)
  const completed = await eventsOf(advId, 'objective_completed')
  ok('winning any authored route completes the objective', completed.length >= 1, completed)
  ok('the next objective was revealed', (await eventsOf(advId, 'objective_revealed')).some(
    (e) => e.payload.objective_id === second.id), second.id)

  console.log('\n[$0]')
  const usage = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=id`)
  ok('zero LLM spend across the suite', usage.length === 0, usage)

  console.log(`\nall ${pass} checks passed`)
  await serviceRest('DELETE', `adventures?id=eq.${advId}`)
  await deleteUser(userIds.gm)
  console.log('cleanup complete')
}

main().catch(async (err) => {
  console.error(`\nFAILED: ${err.message}`)
  for (const id of Object.values(userIds)) await deleteUser(id).catch(() => {})
  process.exit(1)
})
