// Server-side agent text calls for pipeline work (guide-pipeline). Same routing + usage-logging
// contract as ai-proxy's text path, but callable with a service-role client on behalf of a user
// whose JWT isn't present (background jobs). Non-streaming only - pipeline stages are
// parse-and-write, never live output.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { isAgentRole, resolveModel } from './model-routing.ts'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'
const OPENROUTER_EMBEDDINGS_URL = 'https://openrouter.ai/api/v1/embeddings'

/**
 * Memory embeddings (encounter-states Slice 7). text-embedding-3-small at 1024 dims - the
 * cheapest embeddings-capable model reliably on the account ($0.02/M tokens; the dimensions
 * parameter matches the memory_fragments vector(1024) column). Recorded in docs/DECISIONS.md.
 */
export const EMBEDDING_MODEL = 'openai/text-embedding-3-small'
export const EMBEDDING_DIMENSIONS = 1024

export interface EmbeddingCall {
  serviceClient: SupabaseClient
  openRouterApiKey: string
  userId: string
  adventureId: string
  input: string
}

/** Single embedding vector for memory write/read paths. Logged to usage_log like text calls. */
export async function callEmbedding(call: EmbeddingCall): Promise<number[]> {
  const { serviceClient, openRouterApiKey, userId, adventureId, input } = call
  const startedAt = Date.now()
  const res = await fetch(OPENROUTER_EMBEDDINGS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: EMBEDDING_MODEL,
      input: input.slice(0, 6000),
      dimensions: EMBEDDING_DIMENSIONS,
    }),
  })
  const json = await res.json()
  if (!res.ok) {
    throw new AgentCallError(`OpenRouter embeddings error (${res.status}): ${json?.error?.message ?? 'unknown'}`)
  }
  const vector = json?.data?.[0]?.embedding
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new AgentCallError('Embedding response had no usable vector')
  }
  const { error: logError } = await serviceClient.from('usage_log').insert({
    user_id: userId,
    adventure_id: adventureId,
    agent_role: 'summarizer',
    model: EMBEDDING_MODEL,
    kind: 'embedding',
    prompt_tokens: json.usage?.prompt_tokens ?? null,
    completion_tokens: null,
    cost_usd: json.usage?.cost ?? null,
    latency_ms: Date.now() - startedAt,
    response_text: null,
  })
  if (logError) console.error('usage_log insert failed', logError)
  return vector as number[]
}

export interface AgentTextCall {
  serviceClient: SupabaseClient
  openRouterApiKey: string
  userId: string
  adventureId: string
  agentRole: string
  system: string
  user: string
  maxTokens: number
}

/** Thrown when the caller's settings route this request somewhere we can't serve (local mode). */
export class AgentCallError extends Error {}

export async function callAgentText(call: AgentTextCall): Promise<string> {
  const { serviceClient, openRouterApiKey, userId, adventureId, agentRole, system, user, maxTokens } = call
  const startedAt = Date.now()

  const { data: settings, error: settingsError } = await serviceClient
    .from('user_settings')
    .select('provider, model_map')
    .eq('user_id', userId)
    .single()
  if (settingsError || !settings) throw new AgentCallError('Could not load the creator\'s settings')
  if (settings.provider === 'local') {
    throw new AgentCallError('Guide generation requires the OpenRouter provider (local worker mode has no pipeline support yet)')
  }
  if (!isAgentRole(agentRole)) throw new AgentCallError(`Unknown agent_role: ${agentRole}`)
  const model = resolveModel(agentRole, (settings.model_map as Record<string, string>) ?? {})

  const requestBody = (withReasoningOff: boolean, tokens: number) =>
    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: tokens,
      stream: false,
      usage: { include: true },
      // Pipeline calls are structured-output jobs: hybrid reasoning models (deepseek v4) can
      // burn the whole completion budget on reasoning tokens and return EMPTY content (seen
      // live in the Phase 3b smoke test). Ask for reasoning off; fall back without the field
      // for models/providers that reject the parameter.
      ...(withReasoningOff ? { reasoning: { enabled: false } } : {}),
    })

  const post = async (withReasoningOff: boolean, tokens: number) => {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
      body: requestBody(withReasoningOff, tokens),
    })
    return { res, json: await res.json() }
  }
  const logUsage = async (json: {
    usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number }
    choices?: { message?: { content?: string } }[]
  }) => {
    const { error: logError } = await serviceClient.from('usage_log').insert({
      user_id: userId,
      adventure_id: adventureId,
      agent_role: agentRole,
      model,
      kind: 'text',
      prompt_tokens: json.usage?.prompt_tokens ?? null,
      completion_tokens: json.usage?.completion_tokens ?? null,
      cost_usd: json.usage?.cost ?? null,
      latency_ms: Date.now() - startedAt,
      // Debug tab: raw model output, capped so a runaway completion can't bloat the row.
      response_text: json.choices?.[0]?.message?.content?.slice(0, 8000) ?? null,
    })
    if (logError) console.error('usage_log insert failed', logError)
  }

  // Provider moderation refusals sometimes arrive as short CONTENT rather than an error
  // ("The request was rejected because it was considered high risk" - published verbatim as
  // narration, seen live 2026-07-19). Treat them like empty completions: retry, never publish.
  // The same canonical sentence can also arrive APPENDED to an otherwise-good truncated
  // completion (seen in the story sim 2026-07-19) - strip it rather than rejecting the text.
  const REFUSAL_PATTERN = /^(the request was rejected|i can(?:no|')t (?:help|assist|comply|continue)|i'm sorry, (?:but )?i can)/i
  const EMBEDDED_REFUSAL = /The request was rejected because it was considered high risk\.?/g
  const sanitize = (text: string | undefined): string | undefined => {
    if (!text) return text
    const stripped = text.replace(EMBEDDED_REFUSAL, '').trimEnd()
    if (!stripped.trim()) return undefined
    return REFUSAL_PATTERN.test(stripped.trim()) && stripped.trim().length < 240 ? undefined : stripped
  }

  let reasoningOff = true
  let { res, json } = await post(reasoningOff, maxTokens)
  if (res.status >= 400 && res.status < 500) {
    reasoningOff = false
    ;({ res, json } = await post(reasoningOff, maxTokens))
  }
  if (!res.ok) {
    throw new AgentCallError(`OpenRouter error (${res.status}): ${json?.error?.message ?? 'unknown'}`)
  }
  await logUsage(json)

  let content: string | undefined = sanitize(json.choices?.[0]?.message?.content)
  if (!content) {
    // Empty completion (seen live with mimo-v2.5 on structured-output calls): the model spent
    // the whole budget on reasoning tokens despite reasoning-off. Retry once with double the
    // budget so the actual content fits; only then give up.
    ;({ res, json } = await post(reasoningOff, maxTokens * 2))
    if (res.ok) {
      await logUsage(json)
      content = sanitize(json.choices?.[0]?.message?.content)
    }
  }
  if (!content) throw new AgentCallError('Model response had no content')
  return content
}
