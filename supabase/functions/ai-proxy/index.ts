// F01 SS3: the single AI gateway every client call goes through. Verifies the caller's Supabase
// JWT, resolves the model for the request from the caller's settings, proxies to OpenRouter, and
// logs usage. Never accepts a model or API key from the client -- both come from server-side
// state (user_settings row + OPENROUTER_API_KEY secret).
import { createClient } from 'npm:@supabase/supabase-js@2'

import { corsHeaders } from '../_shared/cors.ts'
import { isAgentRole, resolveModel } from '../_shared/model-routing.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY')!
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_AUDIO_URL = 'https://openrouter.ai/api/v1/audio/speech'
const OPENROUTER_IMAGE_URL = 'https://openrouter.ai/api/v1/images'
const OPENROUTER_EMBEDDING_URL = 'https://openrouter.ai/api/v1/embeddings'

type Kind = 'text' | 'tts' | 'image' | 'embedding'

interface ProxyRequestBody {
  kind: Kind
  agent_role: string
  adventure_id?: string | null
  payload: Record<string, unknown>
  stream?: boolean
}

interface UsageLogInput {
  userId: string
  adventureId: string | null | undefined
  agentRole: string
  model: string
  kind: Kind
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number } | null
  latencyMs: number
}

function jsonError(status: number, message: string) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

function openRouterHeaders() {
  return {
    Authorization: `Bearer ${OPENROUTER_API_KEY}`,
    'Content-Type': 'application/json',
  }
}

async function logUsage({ userId, adventureId, agentRole, model, kind, usage, latencyMs }: UsageLogInput) {
  const serviceClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
  const { error } = await serviceClient.from('usage_log').insert({
    user_id: userId,
    adventure_id: adventureId ?? null,
    agent_role: agentRole,
    model,
    kind,
    prompt_tokens: usage?.prompt_tokens ?? null,
    completion_tokens: usage?.completion_tokens ?? null,
    cost_usd: usage?.cost ?? null,
    latency_ms: latencyMs,
  })
  if (error) console.error('usage_log insert failed', error)
}

async function handleText(opts: {
  model: string
  payload: Record<string, unknown>
  stream: boolean
  userId: string
  adventureId: string | null | undefined
  agentRole: string
  startedAt: number
}) {
  const { model, payload, stream, userId, adventureId, agentRole, startedAt } = opts
  const orBody = {
    model,
    messages: payload.messages,
    ...(payload.temperature !== undefined ? { temperature: payload.temperature } : {}),
    ...(payload.max_tokens !== undefined ? { max_tokens: payload.max_tokens } : {}),
    ...(payload.response_format ? { response_format: payload.response_format } : {}),
    stream,
    usage: { include: true },
  }

  if (!stream) {
    const attempt = async () => {
      const res = await fetch(OPENROUTER_CHAT_URL, {
        method: 'POST',
        headers: openRouterHeaders(),
        body: JSON.stringify(orBody),
      })
      const json = await res.json()
      return { res, json }
    }

    let { res, json } = await attempt()
    // Structured-output retry-once-on-parse-failure per F01 SS3.2. Streaming responses skip this
    // -- validating a schema mid-stream would require buffering the whole SSE, defeating the
    // point of streaming; Phase 1's narrator test box only exercises plain streamed text.
    if (payload.response_format && res.ok) {
      const content = json.choices?.[0]?.message?.content
      let parsesOk = false
      try {
        JSON.parse(content)
        parsesOk = true
      } catch {
        parsesOk = false
      }
      if (!parsesOk) {
        ;({ res, json } = await attempt())
      }
    }

    if (!res.ok) return jsonError(res.status, json?.error?.message ?? 'OpenRouter error')

    await logUsage({ userId, adventureId, agentRole, model, kind: 'text', usage: json.usage, latencyMs: Date.now() - startedAt })
    return new Response(JSON.stringify(json), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
  }

  const upstream = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify(orBody),
  })
  if (!upstream.ok || !upstream.body) {
    const errJson = await upstream.json().catch(() => ({}))
    return jsonError(upstream.status, errJson?.error?.message ?? 'OpenRouter error')
  }

  let usageForLog: UsageLogInput['usage'] = null
  const decoder = new TextDecoder()
  let buffer = ''

  const transform = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      controller.enqueue(chunk)
      buffer += decoder.decode(chunk, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue
        const data = line.slice(6).trim()
        if (data === '[DONE]') continue
        try {
          const parsed = JSON.parse(data)
          if (parsed.usage) usageForLog = parsed.usage
        } catch {
          // partial line across chunk boundary -- ignore, next flush will have the rest
        }
      }
    },
    async flush() {
      await logUsage({ userId, adventureId, agentRole, model, kind: 'text', usage: usageForLog, latencyMs: Date.now() - startedAt })
    },
  })

  return new Response(upstream.body.pipeThrough(transform), {
    headers: { ...corsHeaders, 'Content-Type': 'text/event-stream' },
  })
}

async function handleTts(opts: {
  model: string
  payload: Record<string, unknown>
  userId: string
  adventureId: string | null | undefined
  agentRole: string
  startedAt: number
}) {
  const { model, payload, userId, adventureId, agentRole, startedAt } = opts
  if (typeof payload.voice !== 'string') {
    return jsonError(400, 'payload.voice (a voice_id from the Settings voice picker) is required')
  }

  const upstream = await fetch(OPENROUTER_AUDIO_URL, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify({
      model,
      input: payload.input,
      voice: payload.voice,
      response_format: payload.response_format ?? 'mp3',
    }),
  })

  if (!upstream.ok || !upstream.body) {
    const errJson = await upstream.json().catch(() => ({}))
    return jsonError(upstream.status, errJson?.error?.message ?? 'OpenRouter error')
  }

  const generationId = upstream.headers.get('X-Generation-Id')
  const contentType = upstream.headers.get('Content-Type') ?? 'audio/mpeg'

  const [clientStream, loggingStream] = upstream.body.tee()

  ;(async () => {
    // Best-effort cost lookup: the audio endpoint returns raw bytes, not a usage object, so cost
    // is fetched separately via the generation-stats endpoint once bytes finish arriving.
    const reader = loggingStream.getReader()
    while (!(await reader.read()).done) {
      /* drain -- only care about completion timing here */
    }
    let usage: UsageLogInput['usage'] = null
    if (generationId) {
      try {
        const statsRes = await fetch(`https://openrouter.ai/api/v1/generation?id=${generationId}`, {
          headers: openRouterHeaders(),
        })
        if (statsRes.ok) {
          const stats = await statsRes.json()
          usage = { cost: stats.data?.total_cost ?? stats.data?.usage?.cost }
        }
      } catch (err) {
        console.error('generation stats lookup failed', err)
      }
    }
    await logUsage({ userId, adventureId, agentRole, model, kind: 'tts', usage, latencyMs: Date.now() - startedAt })
  })()

  return new Response(clientStream, { headers: { ...corsHeaders, 'Content-Type': contentType } })
}

async function handleImage(opts: {
  model: string
  payload: Record<string, unknown>
  userId: string
  adventureId: string | null | undefined
  agentRole: string
  startedAt: number
}) {
  const { model, payload, userId, adventureId, agentRole, startedAt } = opts
  // Pass the payload through (prompt, aspect_ratio, input_references for image-to-image edits,
  // ...) - the OpenRouter images endpoint owns the schema; the proxy only pins the model.
  const res = await fetch(OPENROUTER_IMAGE_URL, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify({ ...payload, model }),
  })
  const json = await res.json()
  if (!res.ok) return jsonError(res.status, json?.error?.message ?? 'OpenRouter error')

  await logUsage({ userId, adventureId, agentRole, model, kind: 'image', usage: json.usage, latencyMs: Date.now() - startedAt })
  return new Response(JSON.stringify(json), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

async function handleEmbedding(opts: {
  model: string
  payload: Record<string, unknown>
  userId: string
  adventureId: string | null | undefined
  agentRole: string
  startedAt: number
}) {
  const { model, payload, userId, adventureId, agentRole, startedAt } = opts
  const res = await fetch(OPENROUTER_EMBEDDING_URL, {
    method: 'POST',
    headers: openRouterHeaders(),
    body: JSON.stringify({ model, input: payload.input }),
  })
  const json = await res.json()
  if (!res.ok) return jsonError(res.status, json?.error?.message ?? 'OpenRouter error')

  await logUsage({ userId, adventureId, agentRole, model, kind: 'embedding', usage: json.usage, latencyMs: Date.now() - startedAt })
  return new Response(JSON.stringify(json), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders })
  if (req.method !== 'POST') return jsonError(405, 'Method not allowed')

  const startedAt = Date.now()
  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return jsonError(401, 'Missing Authorization header')

    const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData, error: userError } = await userClient.auth.getUser()
    if (userError || !userData.user) return jsonError(401, 'Invalid or expired session')
    const userId = userData.user.id

    const body: ProxyRequestBody = await req.json()
    const { kind, agent_role: agentRole, adventure_id: adventureId, payload, stream } = body

    if (!['text', 'tts', 'image', 'embedding'].includes(kind)) return jsonError(400, 'Invalid kind')
    if (typeof agentRole !== 'string' || agentRole.length === 0) return jsonError(400, 'Missing agent_role')

    const { data: settings, error: settingsError } = await userClient
      .from('user_settings')
      .select('provider, model_map, tts_model, image_model, embedding_model')
      .eq('user_id', userId)
      .single()
    if (settingsError || !settings) return jsonError(500, 'Could not load user settings')

    if (settings.provider === 'local') {
      // Job Queue (F12) isn't built yet -- v1 just rejects so the client knows to fall back.
      return jsonError(409, 'LOCAL_MODE')
    }

    let model: string
    if (kind === 'text') {
      if (!isAgentRole(agentRole)) return jsonError(400, `Unknown agent_role: ${agentRole}`)
      model = resolveModel(agentRole, (settings.model_map as Record<string, string>) ?? {})
    } else if (kind === 'tts') {
      model = settings.tts_model
    } else if (kind === 'image') {
      model = settings.image_model
    } else {
      model = settings.embedding_model
    }

    if (kind === 'text') {
      return await handleText({ model, payload, stream: Boolean(stream), userId, adventureId, agentRole, startedAt })
    }
    if (kind === 'tts') {
      return await handleTts({ model, payload, userId, adventureId, agentRole, startedAt })
    }
    if (kind === 'image') {
      return await handleImage({ model, payload, userId, adventureId, agentRole, startedAt })
    }
    return await handleEmbedding({ model, payload, userId, adventureId, agentRole, startedAt })
  } catch (err) {
    console.error(err)
    return jsonError(500, 'Internal error')
  }
})
