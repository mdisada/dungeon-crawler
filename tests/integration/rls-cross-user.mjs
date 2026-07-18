// F1 RLS cross-user denial check. Runs against the real linked Supabase project (no Docker/local
// stack needed -- see docs/DECISIONS.md 2026-07-17) using two throwaway users created and deleted
// via the Admin API, so it's safe to re-run any time.
//
// Usage: node tests/integration/rls-cross-user.mjs
// Requires (read from frontend/.env.local and backend/.env, same as supabase/README.md's workflow):
//   VITE_SUPABASE_URL, VITE_SUPABASE_PUBLISHABLE_KEY, SUPABASE_SERVICE_ROLE_KEY
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

async function selectAs(token, path) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  })
  return { status: res.status, rows: await res.json() }
}

async function deleteUser(id) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: 'DELETE',
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  })
}

const stamp = Date.now()
const emailA = `f1-rls-a-${stamp}@gmail.com`
const emailB = `f1-rls-b-${stamp}@gmail.com`
let userA, userB

try {
  userA = await createConfirmedUser(emailA)
  userB = await createConfirmedUser(emailB)
  const tokenA = await signIn(emailA)
  const tokenB = await signIn(emailB)

  // A can read their own auto-provisioned rows (trigger from handle_new_user()).
  const ownProfile = await selectAs(tokenA, `profiles?id=eq.${userA}`)
  assert.equal(ownProfile.rows.length, 1, 'user A should see their own profile row')

  const ownSettings = await selectAs(tokenA, `user_settings?user_id=eq.${userA}`)
  assert.equal(ownSettings.rows.length, 1, 'user A should see their own user_settings row')

  // B cannot read A's rows across every RLS-protected F1 table.
  for (const path of [
    `profiles?id=eq.${userA}`,
    `user_settings?user_id=eq.${userA}`,
    `user_api_keys?user_id=eq.${userA}`,
    `usage_log?user_id=eq.${userA}`,
    `worker_tokens?user_id=eq.${userA}`,
    `worker_status?user_id=eq.${userA}`,
  ]) {
    const { rows } = await selectAs(tokenB, path)
    assert.equal(rows.length, 0, `user B should not see user A's rows at ${path}`)
  }

  console.log('PASS: RLS cross-user denial holds across profiles, user_settings, user_api_keys, usage_log, worker_tokens, worker_status')
} finally {
  if (userA) await deleteUser(userA)
  if (userB) await deleteUser(userB)
}
