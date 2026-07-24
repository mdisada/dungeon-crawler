// Shared plumbing for the Adventure Lab runner - the same env/REST/retry patterns the paid
// integration harnesses use (tests/integration/multichapter-playtest.mjs), extracted so the
// lab executor doesn't fork them a third time.
import { readFileSync } from 'node:fs'

function readEnvVar(path, name) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(new RegExp(`^${name}="?(.+?)"?$`, 'm'))
  if (!match) throw new Error(`${name} not found in ${path}`)
  return match[1].trim()
}

export const env = {
  url: readEnvVar('frontend/.env.local', 'VITE_SUPABASE_URL'),
  anonKey: readEnvVar('frontend/.env.local', 'VITE_SUPABASE_PUBLISHABLE_KEY'),
  serviceKey: readEnvVar('backend/.env', 'SUPABASE_SERVICE_ROLE_KEY'),
  openRouterKey: readEnvVar('backend/.env', 'OPENROUTER_API_KEY'),
}

const admin = {
  apikey: env.serviceKey,
  Authorization: `Bearer ${env.serviceKey}`,
  'Content-Type': 'application/json',
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** Retry the TRANSPORT only - an HTTP error response is the caller's business. */
export async function withRetry(label, fn, attempts = 4) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const transient = err instanceof TypeError ||
        /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err?.message ?? err))
      if (!transient) throw err
      await sleep(1000 * 2 ** i)
    }
  }
  throw lastError
}

export async function serviceRest(method, path, payload) {
  return withRetry(`${method} ${path}`, async () => {
    const res = await fetch(`${env.url}/rest/v1/${path}`, {
      method, headers: { ...admin, Prefer: 'return=representation' },
      body: payload === undefined ? undefined : JSON.stringify(payload),
    })
    const body = await res.json().catch(() => null)
    if (!res.ok) throw new Error(`service ${method} ${path} failed: ${res.status} ${JSON.stringify(body)}`)
    return body
  })
}

export async function createConfirmedUser(email, password) {
  const res = await fetch(`${env.url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}

export async function signIn(email, password) {
  const res = await fetch(`${env.url}/auth/v1/token?grant_type=password`, {
    method: 'POST', headers: { apikey: env.anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign in failed: ${res.status}`)
  return body.access_token
}

export async function act(token, payload) {
  return withRetry(`session ${payload.action}`, async () => {
    const res = await fetch(`${env.url}/functions/v1/session`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  })
}

export async function pipeline(token, payload) {
  return withRetry(`pipeline ${payload.action}`, async () => {
    const res = await fetch(`${env.url}/functions/v1/guide-pipeline`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    return { status: res.status, body: await res.json().catch(() => ({})) }
  })
}

/** Deterministic per-run RNG so a rerun with the same id replays the same quality schedule. */
export function seededRng(seed) {
  let h = 1779033703
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353)
    h = (h << 13) | (h >>> 19)
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}
