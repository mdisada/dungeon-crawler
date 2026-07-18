// Phase 4 live integration suite (DEVELOPMENT-PLAN PHASE 4 AI-tests) against the real project:
//   - membership RLS + client-write lockout on adventure_members / adventure_state
//   - join capacity cap + character locking + min-player gating (server-side, via the deployed
//     `session` function)
//   - checkpoint restore reproduces identical state (stable-stringify comparison)
//   - DM-data isolation: player resync carries no dm domain and no hidden-description trap
//     words; dm:{id} channel join is denied to players; game:{id} denied to non-members
//   - realtime: members receive the demo driver's state_diff broadcasts
//
// Creates throwaway users/rows and deletes them at the end; safe to re-run.
// Usage: node tests/integration/session-live.mjs
// Requires: VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (frontend/.env.local),
//           SUPABASE_SERVICE_ROLE_KEY (backend/.env), the `session` function deployed.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'

const require = createRequire(new URL('../../frontend/package.json', import.meta.url))
const { createClient } = require('@supabase/supabase-js')

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
    method: 'POST',
    headers: admin,
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
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign in failed: ${res.status}`)
  return body.access_token
}

async function restAs(token, method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function serviceRest(method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { ...admin, Prefer: 'return=representation' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`service ${method} ${path} failed: ${res.status} ${JSON.stringify(body)}`)
  return body
}

async function sessionAction(token, payload) {
  const res = await fetch(`${url}/functions/v1/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`
}

function subscribeStatus(client, topic) {
  return new Promise((resolve) => {
    const channel = client.channel(topic, { config: { private: true } })
    const timer = setTimeout(() => resolve({ channel, status: 'TIMED_OUT' }), 8000)
    channel.subscribe((status) => {
      if (status === 'SUBSCRIBED' || status === 'CHANNEL_ERROR' || status === 'CLOSED') {
        clearTimeout(timer)
        resolve({ channel, status })
      }
    })
  })
}

const stamp = Date.now()
const emails = {
  dm: `p4-dm-${stamp}@example.com`,
  p1: `p4-p1-${stamp}@example.com`,
  p2: `p4-p2-${stamp}@example.com`,
}
const userIds = {}
let pass = 0

function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` -- ${JSON.stringify(detail)}` : ''}`)
  pass++
  console.log(`  ok: ${label}`)
}

async function main() {
  for (const [key, email] of Object.entries(emails)) userIds[key] = await createConfirmedUser(email)
  const tokens = {
    dm: await signIn(emails.dm),
    p1: await signIn(emails.p1),
    p2: await signIn(emails.p2),
  }
  // The session function reads the creator's settings for LLM routing; demo mode never calls
  // out, but the row must exist (profiles/settings are normally created by the app).
  await serviceRest('POST', 'user_settings?on_conflict=user_id', {
    user_id: userIds.dm,
    provider: 'openrouter',
  }).catch(() => {})

  console.log('setup: users created')

  // --- Adventure A: assist mode, capacity 1, with trap-worded hidden content ---
  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.dm,
    mode: 'assist',
    min_players: 1,
    max_players: 1,
    type: 'one_shot',
    plot_idea: 'Integration test adventure',
    status: 'guide_ready',
    demo: true,
    title: 'P4 Integration Test',
    meta_loop: { premise: 'A test premise with no secrets.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'Test Chapter', arc_summary: 'arc', status: 'active',
  })
  await serviceRest('POST', 'objectives', [
    {
      adventure_id: advId, chapter_id: chapter.id, index: 0, title: 'Visible objective',
      hidden_description: 'DM-ONLY-TRAPWORD-ALPHA lurks here.', reveal_state: 'active',
      completion_predicates: { all: [{ fact: 'done', eq: true }] },
    },
    {
      adventure_id: advId, chapter_id: chapter.id, index: 1, title: 'Hidden objective',
      hidden_description: 'DM-ONLY-TRAPWORD-BETA sleeps below.', reveal_state: 'hidden',
      completion_predicates: { all: [{ fact: 'later', eq: true }] },
    },
  ])

  console.log('\n[activate + join capacity]')
  const act = await sessionAction(tokens.dm, { action: 'activate', adventure_id: advId })
  ok('creator activates guide_ready adventure', act.status === 200, act.body)
  const [{ invite_code: inviteCode }] = await serviceRest('GET', `adventures?id=eq.${advId}&select=invite_code`)

  const join1 = await sessionAction(tokens.p1, { action: 'join', invite_code: inviteCode })
  ok('player 1 joins via invite', join1.status === 200 && join1.body.adventure_id === advId, join1.body)
  const join2 = await sessionAction(tokens.p2, { action: 'join', invite_code: inviteCode })
  ok('player 2 rejected at capacity (max_players=1, DM excluded)', join2.status === 409, join2.body)
  const badJoin = await sessionAction(tokens.p2, { action: 'join', invite_code: 'not-a-real-code' })
  ok('bogus invite code rejected', badJoin.status === 404, badJoin.body)

  console.log('\n[membership RLS]')
  const p1Members = await restAs(tokens.p1, 'GET', `adventure_members?adventure_id=eq.${advId}&select=user_id,role`)
  ok('member reads the member list', p1Members.status === 200 && p1Members.body.length === 2, p1Members.body)
  const p2Members = await restAs(tokens.p2, 'GET', `adventure_members?adventure_id=eq.${advId}&select=user_id`)
  ok('non-member sees zero member rows', p2Members.status === 200 && p2Members.body.length === 0)
  const p2View = await restAs(tokens.p2, 'GET', `member_adventures?id=eq.${advId}&select=id`)
  ok('non-member sees nothing in member_adventures', p2View.status === 200 && p2View.body.length === 0)
  const forgedInsert = await restAs(tokens.p2, 'POST', 'adventure_members', {
    adventure_id: advId, user_id: userIds.p2, role: 'player',
  })
  ok('client insert into adventure_members denied', forgedInsert.status === 403 || forgedInsert.status === 401, forgedInsert.status)
  const forgedReady = await restAs(tokens.p1, 'PATCH', `adventure_members?adventure_id=eq.${advId}&user_id=eq.${userIds.p1}`, { ready: true })
  ok('client update of own member row denied (0 rows)', forgedReady.status === 403 || (Array.isArray(forgedReady.body) && forgedReady.body.length === 0), forgedReady)
  const p1State = await restAs(tokens.p1, 'GET', `adventure_state?adventure_id=eq.${advId}&select=state_version`)
  ok('player cannot select adventure_state (DM-only)', p1State.status === 200 && p1State.body.length === 0)
  const memberView = await restAs(tokens.p1, 'GET', `member_adventures?id=eq.${advId}&select=title,status`)
  ok('member reads the member-safe view', memberView.status === 200 && memberView.body[0]?.status === 'active')

  console.log('\n[character locking]')
  const [char1] = await serviceRest('POST', 'characters', {
    user_id: userIds.p1, name: 'Lock Test PC', level: 1, is_complete: true,
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    skill_proficiencies: ['athletics'], hp_max: 12, hp_current: 12,
  })
  const readyEarly = await sessionAction(tokens.p1, { action: 'ready', adventure_id: advId, ready: true })
  ok('ready without a character rejected', readyEarly.status === 409, readyEarly.body)
  const pick = await sessionAction(tokens.p1, { action: 'pick_character', adventure_id: advId, character_id: char1.id })
  ok('player picks + locks their character', pick.status === 200, pick.body)
  const [lockedRow] = await serviceRest('GET', `characters?id=eq.${char1.id}&select=locked_adventure_id`)
  ok('characters.locked_adventure_id set', lockedRow.locked_adventure_id === advId)

  // Second active adventure (p1 as creator, full_ai so p1 is a player member) - same character
  // must be refused there.
  const [advB] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.p1, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'Second adventure', status: 'guide_ready', demo: true, title: 'P4 Lock Test B',
  })
  const actB = await sessionAction(tokens.p1, { action: 'activate', adventure_id: advB.id })
  ok('second adventure activates', actB.status === 200, actB.body)
  const pickB = await sessionAction(tokens.p1, { action: 'pick_character', adventure_id: advB.id, character_id: char1.id })
  ok('same character rejected in a second active adventure', pickB.status === 409, pickB.body)

  console.log('\n[session lifecycle + min-player gating]')
  const startEarly = await sessionAction(tokens.dm, { action: 'start_session', adventure_id: advId })
  ok('start blocked below min ready players', startEarly.status === 409, startEarly.body)
  const ready = await sessionAction(tokens.p1, { action: 'ready', adventure_id: advId, ready: true })
  ok('ready with character accepted', ready.status === 200, ready.body)
  const startAsPlayer = await sessionAction(tokens.p1, { action: 'start_session', adventure_id: advId })
  ok('player cannot start the session', startAsPlayer.status === 403, startAsPlayer.body)
  const start = await sessionAction(tokens.dm, { action: 'start_session', adventure_id: advId })
  ok('DM starts the session', start.status === 200 && typeof start.body.recap === 'string', start.body)

  const [profileRow] = await serviceRest('GET', `adventures?id=eq.${advId}&select=party_profile`)
  ok('first-session pass wrote a party profile', profileRow.party_profile?.size === 1, profileRow.party_profile)

  console.log('\n[DM isolation on resync]')
  const dmResync = await sessionAction(tokens.dm, { action: 'resync', adventure_id: advId })
  ok('DM resync includes the dm domain', dmResync.body.role === 'dm' && dmResync.body.state.dm !== null)
  ok('DM sees hidden objectives in dm domain', dmResync.body.state.dm.objectives.length === 2)
  const p1Resync = await sessionAction(tokens.p1, { action: 'resync', adventure_id: advId })
  ok('player resync strips the dm domain', p1Resync.body.role === 'player' && p1Resync.body.state.dm === null)
  const playerJson = JSON.stringify(p1Resync.body)
  ok('no hidden trap words reach the player', !playerJson.includes('DM-ONLY-TRAPWORD'))
  ok('player sees only revealed objectives', p1Resync.body.state.objectives.list.every((o) => o.title !== 'Hidden objective'))
  const p2Resync = await sessionAction(tokens.p2, { action: 'resync', adventure_id: advId })
  ok('non-member resync denied', p2Resync.status === 404, p2Resync.body)

  console.log('\n[realtime channels]')
  const p1Client = createClient(url, anonKey, { auth: { persistSession: false } })
  await p1Client.auth.setSession({ access_token: tokens.p1, refresh_token: 'unused' }).catch(() => {})
  // setSession without a valid refresh token can fail; fall back to header auth.
  p1Client.realtime.setAuth(tokens.p1)
  const gameSub = await subscribeStatus(p1Client, `game:${advId}`)
  ok('member subscribes to game channel', gameSub.status === 'SUBSCRIBED', gameSub.status)
  const dmSub = await subscribeStatus(p1Client, `dm:${advId}`)
  ok('player denied on dm channel', dmSub.status !== 'SUBSCRIBED', dmSub.status)

  const p2Client = createClient(url, anonKey, { auth: { persistSession: false } })
  p2Client.realtime.setAuth(tokens.p2)
  const outsiderSub = await subscribeStatus(p2Client, `game:${advId}`)
  ok('non-member denied on game channel', outsiderSub.status !== 'SUBSCRIBED', outsiderSub.status)

  const diffPromise = new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 8000)
    gameSub.channel.on('broadcast', { event: 'state_diff' }, ({ payload }) => {
      clearTimeout(timer)
      resolve(payload)
    })
  })
  const step1 = await sessionAction(tokens.dm, { action: 'demo_step', adventure_id: advId })
  ok('demo driver applies step 1', step1.status === 200, step1.body)
  const diff = await diffPromise
  ok('member received the state_diff broadcast', diff !== null && Array.isArray(diff.diffs), diff === null ? 'timeout' : 'ok')

  console.log('\n[checkpoint restore identity]')
  const before = await sessionAction(tokens.dm, { action: 'resync', adventure_id: advId })
  const checkpoint = await sessionAction(tokens.dm, { action: 'checkpoint', adventure_id: advId, label: 'restore-test' })
  ok('manual checkpoint created', checkpoint.status === 200, checkpoint.body)
  const asPlayerCp = await sessionAction(tokens.p1, { action: 'checkpoint', adventure_id: advId })
  ok('player cannot checkpoint', asPlayerCp.status === 403)
  const step2 = await sessionAction(tokens.dm, { action: 'demo_step', adventure_id: advId })
  ok('demo step 2 mutates state', step2.status === 200)
  const mutated = await sessionAction(tokens.dm, { action: 'resync', adventure_id: advId })
  ok('state changed after the step', stableStringify(mutated.body.state) !== stableStringify(before.body.state))
  const restore = await sessionAction(tokens.dm, { action: 'restore_checkpoint', checkpoint_id: checkpoint.body.checkpoint_id })
  ok('DM restores the checkpoint', restore.status === 200, restore.body)
  const restored = await sessionAction(tokens.dm, { action: 'resync', adventure_id: advId })
  ok('restored state is byte-identical to the snapshot moment',
    stableStringify(restored.body.state) === stableStringify(before.body.state))
  ok('state_version still advanced (no replay confusion)', restored.body.state_version > mutated.body.state_version)

  console.log('\n[session end]')
  // Stage an in-progress roleplay scene directly (service role, version untouched) so the end
  // teardown regression is observable: ending mid-scene must clear the stale dialogue box.
  const [liveRow] = await serviceRest('GET', `adventure_state?adventure_id=eq.${advId}&select=state`)
  const stagedState = liveRow.state
  stagedState.scene.mode = 'roleplay'
  stagedState.dialogue.speakers = [{ npcId: 'stale-npc', name: 'Lingerer', side: 'left', imageUrl: null }]
  stagedState.dialogue.lines = [
    ...(stagedState.dialogue.lines ?? []),
    { id: 'stale-line', speaker: 'Lingerer', npcId: 'stale-npc', text: 'I never leave.' },
  ]
  stagedState.dialogue.activeLineId = 'stale-line'
  await serviceRest('PATCH', `adventure_state?adventure_id=eq.${advId}`, { state: stagedState })

  const end = await sessionAction(tokens.dm, { action: 'end_session', adventure_id: advId })
  ok('DM ends the session (summary + cost)', end.status === 200 && end.body.summary !== undefined, end.body)
  const endedResync = await sessionAction(tokens.dm, { action: 'resync', adventure_id: advId })
  const endedState = endedResync.body.state
  ok('session end returns the scene to narration', endedState.scene.mode === 'narration')
  ok('session end clears the roleplay stage (speakers + active line + addressee)',
    endedState.dialogue.speakers.length === 0 &&
      endedState.dialogue.activeLineId == null &&
      endedState.dialogue.addressedCharacterId == null,
    endedState.dialogue)
  ok('dialogue history survives session end', endedState.dialogue.lines.some((l) => l.id === 'stale-line'))
  const [summaryRow] = await serviceRest('GET', `session_summaries?adventure_id=eq.${advId}&select=id`)
  ok('session summary persisted', Boolean(summaryRow?.id))
  const leave = await sessionAction(tokens.p1, { action: 'leave', adventure_id: advId })
  ok('player leaves', leave.status === 200)
  const [unlockedRow] = await serviceRest('GET', `characters?id=eq.${char1.id}&select=locked_adventure_id`)
  ok('leave unlocks the character', unlockedRow.locked_adventure_id === null)

  await p1Client.removeAllChannels()
  await p2Client.removeAllChannels()
  console.log(`\nPASS (${pass} checks)`)
}

async function cleanup() {
  for (const id of Object.values(userIds)) if (id) await deleteUser(id)
}

main()
  .then(cleanup)
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nFAIL:', err.message ?? err)
    await cleanup()
    process.exit(1)
  })
