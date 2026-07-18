// F01 SS5: local Python worker heartbeat. No worker implementation ships in v1 -- this endpoint,
// the token contract, and the navbar indicator are what v1 provides (per spec).
import { createClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'
import { hashToken } from '../_shared/hash-token.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), {
      status: 405,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const workerToken = req.headers.get('X-Worker-Token')
  if (!workerToken) {
    return new Response(JSON.stringify({ error: 'Missing X-Worker-Token header' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const tokenHash = await hashToken(workerToken)
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)

  const { data: match, error: lookupError } = await serviceClient
    .from('worker_tokens')
    .select('user_id')
    .eq('token_hash', tokenHash)
    .single()
  if (lookupError || !match) {
    return new Response(JSON.stringify({ error: 'Invalid worker token' }), {
      status: 401,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  const now = new Date().toISOString()
  const { error: upsertError } = await serviceClient
    .from('worker_status')
    .upsert({ user_id: match.user_id, last_heartbeat_at: now, updated_at: now })
  if (upsertError) {
    console.error('worker_status upsert failed', upsertError)
    return new Response(JSON.stringify({ error: 'Could not record heartbeat' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
})
