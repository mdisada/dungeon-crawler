// F4 RLS cross-user check for the guide content tables (chapters, objectives, npcs, locations,
// ingredients, coop_sets, encounters, hooks, guide_warnings, guide_jobs, voice_profiles),
// mirroring rls-adventures.mjs (two throwaway users via the Admin API, safe to re-run).
// Verifies: owner CRUD works through the owns_adventure() policies; the other user sees zero
// rows and cannot write; guide_jobs rejects client writes entirely (service-role only); a
// forged insert into someone else's adventure is denied.
//
// Usage: node tests/integration/rls-guide.mjs
// Requires: VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY (frontend/.env.local),
//           SUPABASE_SERVICE_ROLE_KEY (backend/.env)
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

async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}

async function signIn(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign in failed: ${res.status} ${JSON.stringify(body)}`)
  return body.access_token
}

async function restAs(token, method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(method !== 'GET' ? { Prefer: 'return=representation' } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  })
  const text = await res.text()
  return { status: res.status, rows: text ? JSON.parse(text) : [] }
}

async function deleteUser(id) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
}

const stamp = Date.now()
const emailA = `f4-rls-a-${stamp}@gmail.com`
const emailB = `f4-rls-b-${stamp}@gmail.com`
let userA, userB

try {
  userA = await createConfirmedUser(emailA)
  userB = await createConfirmedUser(emailB)
  const tokenA = await signIn(emailA)
  const tokenB = await signIn(emailB)

  const adventure = await restAs(tokenA, 'POST', 'adventures', {
    creator_id: userA,
    plot_idea: 'F4 RLS test plot',
  })
  assert.equal(adventure.status, 201, `adventure insert should succeed: ${JSON.stringify(adventure.rows)}`)
  const adventureId = adventure.rows[0].id

  // Owner can create the whole guide content graph.
  const chapter = await restAs(tokenA, 'POST', 'chapters', {
    adventure_id: adventureId, index: 0, title: 'Ch 1', arc_summary: 'hidden arc',
  })
  assert.equal(chapter.status, 201, `chapter insert should succeed: ${JSON.stringify(chapter.rows)}`)
  const chapterId = chapter.rows[0].id

  const objective = await restAs(tokenA, 'POST', 'objectives', {
    adventure_id: adventureId, chapter_id: chapterId, index: 0, title: 'Defeat Volgarth',
    hidden_description: 'the secret', completion_predicates: { flag: 'done', eq: true },
  })
  assert.equal(objective.status, 201, 'objective insert should succeed')
  const objectiveId = objective.rows[0].id

  const simpleRows = {
    npcs: { adventure_id: adventureId, name: 'Volgarth', role: 'boss', description: 'the boss' },
    locations: { adventure_id: adventureId, name: 'The Chapel', description: 'sunken' },
    coop_sets: { adventure_id: adventureId, kind: 'split_knowledge', reveals: 'the truth' },
    ingredients: { adventure_id: adventureId, type: 'clue', content: { text: 'a clue' } },
    encounters: { adventure_id: adventureId, type: 'battle', spec: { summary: 'fight' } },
    endings: { adventure_id: adventureId, index: 0, title: 'Hidden ending', tone: 'tragic' },
    guide_warnings: { adventure_id: adventureId, message: 'test warning' },
  }
  const insertedIds = {}
  for (const [table, row] of Object.entries(simpleRows)) {
    const res = await restAs(tokenA, 'POST', table, row)
    assert.equal(res.status, 201, `${table} insert should succeed: ${JSON.stringify(res.rows)}`)
    insertedIds[table] = res.rows[0].id
  }
  const hook = await restAs(tokenA, 'POST', 'hooks', {
    adventure_id: adventureId,
    from_ref: { table: 'npcs', id: insertedIds.npcs },
    to_objective_id: objectiveId,
    hook_text: 'a hook',
    kind: 'npc_objective',
  })
  assert.equal(hook.status, 201, 'hook insert should succeed')

  // guide_jobs: no client writes, not even by the owner (service role only).
  const ownerJobInsert = await restAs(tokenA, 'POST', 'guide_jobs', { adventure_id: adventureId, stage: 1 })
  assert.notEqual(ownerJobInsert.status, 201, 'guide_jobs should reject client inserts')

  // Cross-user: B sees zero rows in every guide table, and writes affect zero rows.
  const guideTables = ['chapters', 'objectives', 'npcs', 'locations', 'coop_sets', 'ingredients', 'encounters', 'hooks', 'endings', 'guide_warnings', 'guide_jobs']
  for (const table of guideTables) {
    const read = await restAs(tokenB, 'GET', `${table}?adventure_id=eq.${adventureId}`)
    assert.equal(read.rows.length, 0, `user B should see zero ${table} rows`)
  }
  const bUpdate = await restAs(tokenB, 'PATCH', `objectives?id=eq.${objectiveId}`, { title: 'Hijacked' })
  assert.equal(bUpdate.rows.length, 0, "user B's objective update should affect zero rows")
  const bDelete = await restAs(tokenB, 'DELETE', `npcs?id=eq.${insertedIds.npcs}`)
  assert.equal(bDelete.rows.length, 0, "user B's npc delete should affect zero rows")

  // B cannot insert content into A's adventure.
  const bForged = await restAs(tokenB, 'POST', 'npcs', { adventure_id: adventureId, name: 'Impostor' })
  assert.notEqual(bForged.status, 201, "user B should not insert npcs into A's adventure")

  // voice_profiles are user-owned, not adventure-owned.
  const voiceA = await restAs(tokenA, 'POST', 'voice_profiles', { user_id: userA, name: 'Narrator', storage_path: `${userA}/x.wav` })
  assert.equal(voiceA.status, 201, 'voice profile insert should succeed')
  const bVoiceRead = await restAs(tokenB, 'GET', `voice_profiles?id=eq.${voiceA.rows[0].id}`)
  assert.equal(bVoiceRead.rows.length, 0, "user B should not see A's voice profiles")
  const bForgedVoice = await restAs(tokenB, 'POST', 'voice_profiles', { user_id: userA, name: 'Forged', storage_path: `${userA}/y.wav` })
  assert.notEqual(bForgedVoice.status, 201, 'user B should not insert a voice profile owned by A')

  // A's content is intact after all of B's attempts.
  const intact = await restAs(tokenA, 'GET', `objectives?id=eq.${objectiveId}`)
  assert.equal(intact.rows.length, 1, "user A's objective should still exist")
  assert.equal(intact.rows[0].title, 'Defeat Volgarth', "user A's objective should be unchanged")

  console.log('PASS: RLS cross-user denial holds for all guide content tables + guide_jobs write lockout')
} finally {
  if (userA) await deleteUser(userA)
  if (userB) await deleteUser(userB)
}
