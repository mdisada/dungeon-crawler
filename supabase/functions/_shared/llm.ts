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
  /**
   * JSON Schema for the reply. Every curated model advertises `structured_outputs` (verified
   * against the OpenRouter models API, 2026-07-21), and the Settings picker only offers curated
   * models - but model_map is free-form jsonb, so a rejected schema falls back to the prose
   * path rather than failing the call.
   *
   * This guarantees SHAPE ONLY. Semantic validation stays exactly where it is: a
   * schema-conformant reply can still claim an off-vocabulary milestone, and the parsers in
   * _shared/play and _shared/story are what catch that.
   */
  schema?: { name: string; schema: Record<string, unknown> }
}

/** Thrown when the caller's settings route this request somewhere we can't serve (local mode). */
export class AgentCallError extends Error {}

export interface AgentTextResult {
  text: string
  /** completion_tokens of the response that produced `text`; null when the provider omits usage. */
  completionTokens: number | null
  /** 'length' means the reply was cut off at `maxTokens` - the signal that decides HIT CAP vs STOPPED EARLY. */
  finishReason: string | null
  /** The max_tokens cap that produced `text` (a truncation-retry doubles it), for the completion_tokens comparison. */
  maxTokens: number
}

/** Text-only convenience over callAgentTextWithMeta - most callers do not need the token diagnostics. */
export async function callAgentText(call: AgentTextCall): Promise<string> {
  return (await callAgentTextWithMeta(call)).text
}

/**
 * As callAgentText, but returns the completion_tokens/finish_reason/cap of the reply alongside it.
 * agentJson attaches these to `agent_output_unparsed` so a parse failure can be read directly -
 * at the cap means the budget cut it off, well short means the model stopped on its own and no
 * cap will help. Two "fixes" shipped against the adjudicator 500 without this number in hand.
 */
export async function callAgentTextWithMeta(call: AgentTextCall): Promise<AgentTextResult> {
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

  const requestBody = (withReasoningOff: boolean, tokens: number, withSchema: boolean) =>
    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: tokens,
      stream: false,
      usage: { include: true },
      ...(withSchema && call.schema
        ? {
            response_format: {
              type: 'json_schema',
              json_schema: { name: call.schema.name, strict: true, schema: call.schema.schema },
            },
          }
        : {}),
      // Pipeline calls are structured-output jobs: hybrid reasoning models (deepseek v4) can
      // burn the whole completion budget on reasoning tokens and return EMPTY content (seen
      // live in the Phase 3b smoke test). Ask for reasoning off; fall back without the field
      // for models/providers that reject the parameter.
      ...(withReasoningOff ? { reasoning: { enabled: false } } : {}),
    })

  const post = async (withReasoningOff: boolean, tokens: number, withSchema = true) => {
    const res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
      body: requestBody(withReasoningOff, tokens, withSchema),
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
  let schemaOn = Boolean(call.schema)
  let { res, json } = await post(reasoningOff, maxTokens, schemaOn)
  // A 4xx can mean the provider rejected reasoning-off OR the schema; peel them off in turn
  // rather than failing a call the prose path could still serve.
  if (res.status >= 400 && res.status < 500 && schemaOn) {
    schemaOn = false
    ;({ res, json } = await post(reasoningOff, maxTokens, schemaOn))
  }
  if (res.status >= 400 && res.status < 500) {
    reasoningOff = false
    ;({ res, json } = await post(reasoningOff, maxTokens, schemaOn))
  }
  if (!res.ok) {
    throw new AgentCallError(`OpenRouter error (${res.status}): ${json?.error?.message ?? 'unknown'}`)
  }
  await logUsage(json)

  let content: string | undefined = sanitize(json.choices?.[0]?.message?.content)
  // Track the response that actually produced `content` so the diagnostics below describe the
  // reply the caller receives, not a discarded empty retry.
  let chosen = json
  let chosenCap = maxTokens
  // A completion cut off at the token cap is NOT empty, so it used to skip the retry below and
  // hand half-written JSON to the parser, which died as "adjudication: not an object" (live
  // 2026-07-21, 3 turns lost across two runs). Strict json_schema is what exposed it: the model
  // must emit every required key, nulls included, so schema'd calls run materially longer than
  // the prose ones whose budgets were set before schemas existed.
  const truncated = json.choices?.[0]?.finish_reason === 'length'
  if (!content || truncated) {
    // Empty completion (seen live with mimo-v2.5 on structured-output calls): the model spent
    // the whole budget on reasoning tokens despite reasoning-off. Retry once with double the
    // budget so the actual content fits; only then give up.
    const retry = await post(reasoningOff, maxTokens * 2, schemaOn)
    if (retry.res.ok) {
      await logUsage(retry.json)
      // Keep the retry only if it actually said something. A truncated first reply is useless
      // JSON but perfectly usable prose, so never trade it for an empty second one.
      const retryContent = sanitize(retry.json.choices?.[0]?.message?.content)
      if (retryContent) {
        content = retryContent
        chosen = retry.json
        chosenCap = maxTokens * 2
      }
    }
  }
  if (!content) throw new AgentCallError('Model response had no content')
  return {
    text: content,
    completionTokens: chosen.usage?.completion_tokens ?? null,
    finishReason: chosen.choices?.[0]?.finish_reason ?? null,
    maxTokens: chosenCap,
  }
}
