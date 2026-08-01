// F12 narration TTS: turns one line's reveal chunks into cached, shared narration audio.
//
// Client-invoked and fire-and-forget. Any client that sees a new line calls this; the claim in
// claim_narration_clip makes exactly one of them the synthesizer, so a four-player table pays for
// one reading and everyone hears the same take.
//
// It does NOT touch the session function, apply_diff, or state_version. Chunk readiness is
// broadcast on its own `narration:{scope}` topic, so nothing about this feature can perturb the
// state-diff version chain that use-game-state resyncs on.
//
// The response returns as soon as the cache has been consulted - listing which chunks are already
// playable - and the actual synthesis continues under EdgeRuntime.waitUntil, publishing each chunk
// by broadcast as it lands.
import { createClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'
import { isFishModel } from '../_shared/fish.ts'
import { allowlistMessage, isAllowedMediaModel } from '../_shared/media-models.ts'
import { bustCache, cacheKeyFor, planChunks } from './cache.ts'
import type { SynthesisContext } from './cache.ts'
import { DEFAULT_MAX_IN_FLIGHT, runSynthesis } from './synthesis.ts'
import { resolveFishReference, resolveVoiceProfileId } from './voice.ts'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

declare const EdgeRuntime: { waitUntil?: (p: Promise<unknown>) => void } | undefined

// Narration's own default, deliberately not user_settings.tts_model (still 's1', two generations
// back). That setting governs the Assets Lab and voice previews, where comparing engines is the
// point; narration wants the current production engine without a per-user opt-in.
const DEFAULT_NARRATION_MODEL = 's2.1-pro'

// Sanity bounds, not product limits: a reveal chunk is <=240 chars (features/play/sentences.ts) and
// a narration line is a handful of them. Anything past this is a malformed or hostile request.
const MAX_CHUNKS = 24
const MAX_TOTAL_CHARS = 8_000

interface NarrationRequestBody {
  adventure_id?: string | null
  line_id?: string
  npc_id?: string | null
  chunks?: unknown
  model?: string
  voice_profile_id?: string | null
  max_in_flight?: number
  force?: boolean
  /**
   * Resolve and REGISTER the voice, synthesize nothing. A built-in voice ships with no
   * fish_reference_id (see supabase/seed/seed-builtin-voices.mjs), so the first line to use one
   * pays ~9s in Fish's POST /model before a single character is spoken. The play screen sends this
   * on mount, which moves that cost to a moment nobody is waiting on. Free and idempotent
   * afterwards: the id is cached on the profile row.
   */
  warm?: boolean
}

function json(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function parseChunks(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0 || raw.length > MAX_CHUNKS) return null
  const texts = raw.map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
  if (texts.some((text) => text.length === 0)) return null
  if (texts.reduce((total, text) => total + text.length, 0) > MAX_TOTAL_CHARS) return null
  return texts
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return json(405, { error: 'Method not allowed' })

  // Cumulative marks from the top of the request, returned to the caller. Everything before the
  // first Fish call is dead time the player spends waiting on a box, and it is invisible from the
  // client - which measures only from when it sent the request. Measured, not assumed: the first
  // call for an unregistered voice spends ~9s in Fish's POST /model, and without these marks that
  // is indistinguishable from slow synthesis.
  const startedAt = Date.now()
  const timings: Record<string, number> = {}
  const mark = (name: string) => {
    timings[name] = Date.now() - startedAt
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return json(401, { error: 'Missing Authorization header' })

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return json(401, { error: 'Invalid or expired session' })
    const userId = userData.user.id
    mark('auth')

    const body = (await req.json()) as NarrationRequestBody
    const isWarm = body.warm === true
    // A warm-up has no line to speak. The id only ever labels synthesis, so it gets a placeholder
    // rather than making everything downstream nullable for a request that never reaches it.
    const lineId = typeof body.line_id === 'string' && body.line_id ? body.line_id : isWarm ? 'warm-up' : null
    if (!lineId) return json(400, { error: 'line_id is required' })

    const texts = isWarm ? [] : parseChunks(body.chunks)
    if (!texts) return json(400, { error: `chunks must be 1-${MAX_CHUNKS} non-empty strings` })

    const service = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
    const adventureId = typeof body.adventure_id === 'string' && body.adventure_id ? body.adventure_id : null

    const model = body.model ?? DEFAULT_NARRATION_MODEL
    if (!isAllowedMediaModel(model)) return json(403, { error: allowlistMessage(model) })
    if (!isFishModel(model)) return json(400, { error: `Narration requires a Fish engine, got '${model}'` })

    // Authorization: a table's narration is readable by its members and nobody else. A lab run has
    // no adventure, so it is scoped to the caller and needs no further check.
    //
    // The two lookups run TOGETHER, and the whole check runs alongside voice resolution below.
    // Everything from here to the first Fish call is time the player spends on the previous beat -
    // measured at ~1.0s of pure round trips - and none of these three answers depends on another.
    const authorize = async (): Promise<{ status: number; error: string } | null> => {
      if (!adventureId) return null
      const [{ data: adventure }, { data: member }] = await Promise.all([
        service.from('adventures').select('id, creator_id').eq('id', adventureId).maybeSingle(),
        service
          .from('adventure_members')
          .select('id')
          .eq('adventure_id', adventureId)
          .eq('user_id', userId)
          .maybeSingle(),
      ])
      if (!adventure) return { status: 404, error: 'Adventure not found' }
      if (adventure.creator_id !== userId && !member) {
        return { status: 403, error: 'Not a member of this adventure' }
      }
      return null
    }

    // Reads only, and its result is used only after the authorization check below has passed.
    const resolveProfile = resolveVoiceProfileId(service, {
      adventureId,
      npcId: typeof body.npc_id === 'string' ? body.npc_id : null,
      explicitProfileId: typeof body.voice_profile_id === 'string' ? body.voice_profile_id : null,
      callerId: userId,
    }).then(
      (id) => ({ id, error: null as string | null }),
      (err: unknown) => ({ id: null, error: err instanceof Error ? err.message : 'Voice not available' }),
    )

    const [denied, voice] = await Promise.all([authorize(), resolveProfile])
    if (denied) return json(denied.status, { error: denied.error })
    // A resolution failure means the caller asked for a voice that is not theirs (the lab and the
    // guide's audition pass an explicit id), so it stays a 403 - but only once authorization has
    // had its say, or this would answer a question the caller was not entitled to ask.
    if (voice.error) return json(403, { error: voice.error })
    const profileId = voice.id
    mark('authorize')

    // Reachable only when no built-in default is seeded (see resolveVoiceProfileId): the line stays
    // silent, the client ungates immediately, and nothing is spent. Never an error.
    if (!profileId) {
      mark('total')
      return json(200, { line_id: lineId, silent: true, model, chunks: [], timings, warmed: isWarm })
    }

    // Registration (Fish POST /model, ~9s) is deliberately behind the authorization check: it is
    // billable work, and an unauthorized caller must not be able to trigger it.
    let referenceId: string | null = null
    try {
      ;({ referenceId } = await resolveFishReference(service, profileId))
    } catch (err) {
      return json(400, { error: err instanceof Error ? err.message : 'Could not resolve the voice' })
    }
    mark('voice')

    // Warming stops here: the voice is registered and cached, and the next real line skips it.
    if (isWarm) {
      mark('total')
      return json(200, { line_id: lineId, silent: false, model, voice_profile_id: profileId, chunks: [], timings, warmed: true })
    }

    const ctx: SynthesisContext = {
      service,
      scope: adventureId ?? `lab-${userId}`,
      adventureId,
      ownerId: userId,
      lineId,
      model,
      referenceId,
    }

    if (body.force === true) {
      await bustCache(ctx, await Promise.all(texts.map((text) => cacheKeyFor(ctx, text))))
      mark('bust')
    }

    const plans = await planChunks(ctx, texts)
    mark('plan')
    const maxInFlight = Number.isFinite(body.max_in_flight)
      ? Math.max(1, Math.trunc(body.max_in_flight as number))
      : DEFAULT_MAX_IN_FLIGHT

    const work = runSynthesis(ctx, plans, maxInFlight).catch((err) =>
      console.error('narration synthesis failed', err),
    )
    if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) EdgeRuntime.waitUntil(work)

    mark('total')
    return json(202, {
      line_id: lineId,
      silent: false,
      model,
      voice_profile_id: profileId,
      chunks: plans.map((plan) => ({ index: plan.index, status: plan.status, url: plan.url })),
      timings,
    })
  } catch (err) {
    console.error('narration-tts failed', err)
    return json(500, { error: err instanceof Error ? err.message : 'Narration synthesis failed' })
  }
})
