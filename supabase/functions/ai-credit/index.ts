// F01 SS3.4: GET remaining OpenRouter credit for the navbar usage meter. Polls OpenRouter's key
// endpoint at most once per 60s (cached in the single-row openrouter_credit_cache table) since
// the platform key's remaining credit is shared across all users, not per-user state.
import { createClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const CACHE_TTL_MS = 60_000

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Missing Authorization header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: userData, error: userError } = await userClient.auth.getUser()
  if (userError || !userData.user) {
    return new Response(JSON.stringify({ error: 'Invalid or expired session' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { data: cache } = await serviceClient
    .from('openrouter_credit_cache')
    .select('credit_usd, fetched_at')
    .eq('id', true)
    .single()

  const isFresh = cache?.fetched_at && Date.now() - new Date(cache.fetched_at).getTime() < CACHE_TTL_MS
  if (isFresh) {
    return new Response(JSON.stringify({ credit_usd: cache.credit_usd }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const res = await fetch('https://openrouter.ai/api/v1/key', {
    headers: { Authorization: `Bearer ${OPENROUTER_API_KEY}` },
  })
  if (!res.ok) {
    // Serve the last known value rather than erroring the navbar meter if OpenRouter is down.
    return new Response(JSON.stringify({ credit_usd: cache?.credit_usd ?? null, stale: true }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
  const json = await res.json()
  const limit = json.data?.limit
  const remaining = json.data?.limit_remaining
  const creditUsd = typeof limit === 'number' && typeof remaining === 'number' ? remaining : null

  await serviceClient
    .from('openrouter_credit_cache')
    .update({ credit_usd: creditUsd, fetched_at: new Date().toISOString() })
    .eq('id', true)

  return new Response(JSON.stringify({ credit_usd: creditUsd }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
