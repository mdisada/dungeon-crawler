// F2 RLS cross-user check for the `characters` table. Mirrors rls-cross-user.mjs's pattern
// (two throwaway users via the Admin API, safe to re-run any time) but also exercises
// insert/update/delete denial, not just select, since characters are the first user-owned table
// this project seeds through the app rather than only reading.
//
// Usage: node tests/integration/rls-characters.mjs
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
const emailA = `f2-rls-a-${stamp}@gmail.com`
const emailB = `f2-rls-b-${stamp}@gmail.com`
let userA, userB, characterAId

try {
  userA = await createConfirmedUser(emailA)
  userB = await createConfirmedUser(emailB)
  const tokenA = await signIn(emailA)
  const tokenB = await signIn(emailB)

  // A can create and read their own character.
  const created = await restAs(tokenA, 'POST', 'characters', { user_id: userA, name: 'RLS Test Character' })
  assert.equal(created.status, 201, `insert should succeed: ${JSON.stringify(created.rows)}`)
  characterAId = created.rows[0].id

  const ownRead = await restAs(tokenA, 'GET', `characters?id=eq.${characterAId}`)
  assert.equal(ownRead.rows.length, 1, 'user A should see their own character')

  // B cannot see, update, or delete A's character.
  const bRead = await restAs(tokenB, 'GET', `characters?id=eq.${characterAId}`)
  assert.equal(bRead.rows.length, 0, "user B should not see user A's character")

  const bUpdate = await restAs(tokenB, 'PATCH', `characters?id=eq.${characterAId}`, { name: 'Hijacked' })
  assert.equal(bUpdate.rows.length, 0, "user B's update should affect zero rows")

  const bDelete = await restAs(tokenB, 'DELETE', `characters?id=eq.${characterAId}`)
  assert.equal(bDelete.rows.length, 0, "user B's delete should affect zero rows")

  // B cannot insert a character claiming to be owned by A.
  const bForgedInsert = await restAs(tokenB, 'POST', 'characters', { user_id: userA, name: 'Forged' })
  assert.notEqual(bForgedInsert.status, 201, "user B should not be able to insert a character owned by user A")

  // A's row is unaffected by B's attempts.
  const stillOwned = await restAs(tokenA, 'GET', `characters?id=eq.${characterAId}`)
  assert.equal(stillOwned.rows.length, 1, "user A's character should be untouched")
  assert.equal(stillOwned.rows[0].name, 'RLS Test Character', "user A's character name should be unchanged")

  console.log('PASS: RLS cross-user denial holds for characters (select/insert/update/delete)')
} finally {
  if (userA) await deleteUser(userA) // cascades characters via user_id FK on delete cascade
  if (userB) await deleteUser(userB)
}
