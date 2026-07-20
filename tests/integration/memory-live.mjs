// Encounter-states Slice 7 pgvector check against the live DB - $0 (synthetic embeddings,
// no LLM calls). Verifies: insert with a 1024-dim vector, nearest-neighbor retrieval order
// via the match_memory_fragments RPC, adventure scoping, and that anon clients read nothing.
// Usage: node tests/integration/memory-live.mjs
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
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }

async function serviceRest(method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method, headers: { ...admin, Prefer: 'return=representation' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`service ${method} ${path} failed: ${res.status} ${JSON.stringify(body)}`)
  return body
}

let pass = 0
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` -- ${JSON.stringify(detail)}` : ''}`)
  pass++
  console.log(`  ok: ${label}`)
}

/** Unit vector concentrated on one axis, padded to 1024 dims. */
function axisVector(axis) {
  const v = new Array(1024).fill(0)
  v[axis] = 1
  return JSON.stringify(v)
}

async function main() {
  const [userRow] = await serviceRest('GET', 'adventures?select=creator_id&limit=1')
  const creatorId = userRow?.creator_id
  let adventure
  if (creatorId) {
    ;[adventure] = await serviceRest('POST', 'adventures', {
      creator_id: creatorId, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
      plot_idea: 'memory test', status: 'draft', demo: true, title: 'Memory Fragments Test', meta_loop: {},
    })
  } else {
    throw new Error('need at least one existing adventure row to borrow a creator_id')
  }
  const advId = adventure.id
  const [other] = await serviceRest('POST', 'adventures', {
    creator_id: creatorId, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'memory test 2', status: 'draft', demo: true, title: 'Memory Fragments Test B', meta_loop: {},
  })

  try {
    await serviceRest('POST', 'memory_fragments', [
      { adventure_id: advId, kind: 'encounter', content: 'The causeway challenge ended in partial success.', embedding: axisVector(0) },
      { adventure_id: advId, kind: 'scene_summary', content: 'Maren promised the party the old charts.', embedding: axisVector(1) },
      { adventure_id: other.id, kind: 'encounter', content: 'WRONG ADVENTURE fragment.', embedding: axisVector(0) },
    ])
    ok('fragments inserted with 1024-dim vectors', true)

    const near0 = await serviceRest('POST', 'rpc/match_memory_fragments', {
      p_adventure_id: advId, p_query: axisVector(0), p_k: 2,
    })
    ok('nearest-neighbor order puts the matching fragment first',
      near0.length === 2 && near0[0].content.includes('causeway') && near0[0].similarity > near0[1].similarity, near0)
    ok('retrieval is adventure-scoped', near0.every((r) => !r.content.includes('WRONG')), near0)

    const near1 = await serviceRest('POST', 'rpc/match_memory_fragments', {
      p_adventure_id: advId, p_query: axisVector(1), p_k: 1,
    })
    ok('a different query surfaces the other fragment', near1.length === 1 && near1[0].content.includes('Maren'), near1)

    const anonRes = await fetch(`${url}/rest/v1/memory_fragments?select=id`, {
      headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}` },
    })
    const anonBody = await anonRes.json().catch(() => null)
    ok('anon clients read no fragments', Array.isArray(anonBody) && anonBody.length === 0, anonBody)

    console.log(`\nall ${pass} checks passed`)
  } finally {
    await serviceRest('DELETE', `adventures?id=eq.${advId}`)
    await serviceRest('DELETE', `adventures?id=eq.${other.id}`)
    console.log('cleanup complete')
  }
}

main().catch((err) => {
  console.error('\nFAILED:', err.message ?? err)
  process.exitCode = 1
})
