// F3 RLS cross-user check for the `adventures` table, mirroring rls-characters.mjs (two
// throwaway users via the Admin API, safe to re-run any time). Covers select/insert/update/
// delete denial plus the "Previous ideas" query only surfacing the current user's plots
// (F03 SS3.4 acceptance: "Previous-ideas dropdown only shows the current user's plots").
//
// Usage: node tests/integration/rls-adventures.mjs
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
const emailA = `f3-rls-a-${stamp}@gmail.com`
const emailB = `f3-rls-b-${stamp}@gmail.com`
let userA, userB, adventureAId

try {
  userA = await createConfirmedUser(emailA)
  userB = await createConfirmedUser(emailB)
  const tokenA = await signIn(emailA)
  const tokenB = await signIn(emailB)

  // A can create and read their own adventure draft.
  const created = await restAs(tokenA, 'POST', 'adventures', {
    creator_id: userA,
    plot_idea: 'RLS test plot: the vault under the opera house',
  })
  assert.equal(created.status, 201, `insert should succeed: ${JSON.stringify(created.rows)}`)
  adventureAId = created.rows[0].id

  const ownRead = await restAs(tokenA, 'GET', `adventures?id=eq.${adventureAId}`)
  assert.equal(ownRead.rows.length, 1, 'user A should see their own adventure')

  // B cannot see, update, or delete A's adventure.
  const bRead = await restAs(tokenB, 'GET', `adventures?id=eq.${adventureAId}`)
  assert.equal(bRead.rows.length, 0, "user B should not see user A's adventure")

  const bUpdate = await restAs(tokenB, 'PATCH', `adventures?id=eq.${adventureAId}`, { plot_idea: 'Hijacked' })
  assert.equal(bUpdate.rows.length, 0, "user B's update should affect zero rows")

  const bDelete = await restAs(tokenB, 'DELETE', `adventures?id=eq.${adventureAId}`)
  assert.equal(bDelete.rows.length, 0, "user B's delete should affect zero rows")

  // B cannot insert an adventure claiming to be created by A.
  const bForgedInsert = await restAs(tokenB, 'POST', 'adventures', { creator_id: userA, plot_idea: 'Forged' })
  assert.notEqual(bForgedInsert.status, 201, 'user B should not be able to insert an adventure owned by user A')

  // The "Previous ideas" query shape only returns the caller's own plots.
  const bPreviousIdeas = await restAs(tokenB, 'GET', 'adventures?select=plot_idea&plot_idea=neq.')
  assert.equal(
    bPreviousIdeas.rows.filter((row) => row.plot_idea.startsWith('RLS test plot')).length,
    0,
    "user B's previous-ideas query should not surface user A's plots",
  )

  // A's row is unaffected by B's attempts.
  const stillOwned = await restAs(tokenA, 'GET', `adventures?id=eq.${adventureAId}`)
  assert.equal(stillOwned.rows.length, 1, "user A's adventure should be untouched")
  assert.ok(
    stillOwned.rows[0].plot_idea.startsWith('RLS test plot'),
    "user A's plot idea should be unchanged",
  )

  console.log('PASS: RLS cross-user denial holds for adventures (select/insert/update/delete)')
} finally {
  if (userA) await deleteUser(userA) // cascades adventures via creator_id FK on delete cascade
  if (userB) await deleteUser(userB)
}
