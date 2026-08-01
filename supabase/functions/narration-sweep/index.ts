// F12 narration retention: deletes narration audio older than 7 days.
//
// Invoked nightly by pg_cron via pg_net (scheduled in 20260801170000_narration_audio.sql), and
// callable by hand with the service-role key when you want to reclaim space now.
//
// Expiry is safe by construction: the cache is content-addressed, so a swept clip is simply
// re-synthesized the next time that exact text is spoken in that voice. Nothing references a clip
// durably - signed URLs are handed out per line and live only as long as the line is on screen.
//
// Storage first, ledger second. If the row went first, a failed object delete would orphan the
// file with nothing left pointing at it; this way a failure just leaves the row for tomorrow.
import { createClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const BUCKET = 'narration-audio'
const RETENTION_DAYS = 7
// Storage.remove takes a list; kept modest so one bad path fails a small batch, not the sweep.
const BATCH = 100

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // Service role only - same check the session function uses for its internal continuation. This
  // is a destructive janitorial job; no user token should ever be able to run it.
  const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (token !== SUPABASE_SERVICE_ROLE_KEY) return json(403, { error: 'Service role required' })

  const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const { data: expired, error } = await service
    .from('narration_clips')
    .select('id, storage_path')
    .lt('created_at', cutoff)
  if (error) return json(500, { error: `expired lookup failed: ${error.message}` })

  const rows = expired ?? []
  let removed = 0
  const failures: string[] = []

  for (let start = 0; start < rows.length; start += BATCH) {
    const batch = rows.slice(start, start + BATCH)
    const { error: removeError } = await service.storage
      .from(BUCKET)
      .remove(batch.map((row) => row.storage_path as string))
    if (removeError) {
      failures.push(removeError.message)
      continue
    }
    const { error: deleteError } = await service
      .from('narration_clips')
      .delete()
      .in('id', batch.map((row) => row.id as string))
    if (deleteError) {
      failures.push(deleteError.message)
      continue
    }
    removed += batch.length
  }

  console.log(`narration-sweep: ${removed}/${rows.length} clips older than ${RETENTION_DAYS}d removed`)
  return json(200, { expired: rows.length, removed, failures })
})
