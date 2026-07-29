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

/**
 * Node's fetch reports EVERY transport failure as the same opaque `TypeError: fetch failed`, and
 * puts the fact worth knowing - ECONNRESET vs ENOTFOUND vs UND_ERR_HEADERS_TIMEOUT - on `.cause`.
 * Every layer here then logged `err.message`, so six lab runs died with a one-line error that
 * cannot be acted on and nobody ever learned which failure it was.
 */
export function describeError(err) {
  const chain = []
  for (let cur = err, depth = 0; cur && depth < 5; depth++, cur = cur.cause) {
    const code = cur.code ? ` [${cur.code}]` : ''
    const where = cur.address ? ` ${cur.address}${cur.port ? `:${cur.port}` : ''}` : ''
    chain.push(`${cur.name ?? 'Error'}: ${cur.message ?? String(cur)}${code}${where}`)
  }
  return chain.join('  <-  ')
}

/**
 * Retry the TRANSPORT only - an HTTP error response is the caller's business.
 *
 * Eight attempts, backoff capped at 30s: 1+2+4+8+16+30+30 = ~91 seconds of tolerance. It was four
 * attempts, which is 1+2+4 = SEVEN SECONDS, and that is shorter than any real network
 * interruption - a wifi reconnect, a laptop waking, a router blip. Six lab runs died with "fetch
 * failed" at 6.8, 10.4, 11.7 and 19.9 minutes, timings with no pattern except that something
 * briefly went away, and each one threw away a 20-40 minute paid run to ride out something that
 * would have cleared in under a minute.
 *
 * Waiting 90 seconds to save a 25-minute run is trivially the right trade.
 */
export async function withRetry(label, fn, attempts = 8) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastError = err
      const transient = err instanceof TypeError ||
        /fetch failed|ECONNRESET|ETIMEDOUT|socket hang up/i.test(String(err?.message ?? err))
      if (!transient) throw err
      // Every attempt is reported, not just the last. A run that survives on attempt 3 looks
      // identical to one that never stumbled, so the fact that the transport is degrading -
      // which is what precedes the failures - has been invisible.
      console.error(`  [retry ${i + 1}/${attempts}] ${label}: ${describeError(err)}`)
      await sleep(Math.min(1000 * 2 ** i, 30_000))
    }
  }
  // Named so the run row says WHICH call gave up, not just that something did.
  throw new Error(`${label} failed after ${attempts} attempts: ${describeError(lastError)}`, { cause: lastError })
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
    // Read the stream ONCE as text, then parse - res.json() consumes it, so a later res.text()
    // returns nothing and a 5xx arrives as an empty body. On failure keep the raw text and the
    // gateway's request id: that is what tells BOOT_ERROR from WORKER_RESOURCE_LIMIT from a bare
    // gateway 503, which took a forensic pass to guess at last time (2026-07-27).
    const raw = await res.text().catch(() => '')
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      body = {}
    }
    if (res.ok) return { status: res.status, body }
    return {
      status: res.status,
      body,
      raw: raw.slice(0, 400),
      requestId: res.headers.get('sb-request-id') ?? res.headers.get('x-served-by') ?? null,
    }
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
