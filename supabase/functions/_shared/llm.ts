// Server-side agent text calls for pipeline work (guide-pipeline). Same routing + usage-logging
// contract as ai-proxy's text path, but callable with a service-role client on behalf of a user
// whose JWT isn't present (background jobs). Non-streaming only - pipeline stages are
// parse-and-write, never live output.
import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { isAgentRole, resolveModel } from './model-routing.ts'

const OPENROUTER_CHAT_URL = 'https://openrouter.ai/api/v1/chat/completions'

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

  const requestBody = (withReasoningOff: boolean) =>
    JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: maxTokens,
      stream: false,
      usage: { include: true },
      // Pipeline calls are structured-output jobs: hybrid reasoning models (deepseek v4) can
      // burn the whole completion budget on reasoning tokens and return EMPTY content (seen
      // live in the Phase 3b smoke test). Ask for reasoning off; fall back without the field
      // for models/providers that reject the parameter.
      ...(withReasoningOff ? { reasoning: { enabled: false } } : {}),
    })

  let res = await fetch(OPENROUTER_CHAT_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
    body: requestBody(true),
  })
  let json = await res.json()
  if (res.status >= 400 && res.status < 500) {
    res = await fetch(OPENROUTER_CHAT_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${openRouterApiKey}`, 'Content-Type': 'application/json' },
      body: requestBody(false),
    })
    json = await res.json()
  }
  if (!res.ok) {
    throw new AgentCallError(`OpenRouter error (${res.status}): ${json?.error?.message ?? 'unknown'}`)
  }

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
  })
  if (logError) console.error('usage_log insert failed', logError)

  const content: string | undefined = json.choices?.[0]?.message?.content
  if (!content) throw new AgentCallError('Model response had no content')
  return content
}
