import { callEdgeFunction } from '@/lib/edge-function'
import type { AgentRole } from '../model-routing'

export interface StreamAgentTextInput {
  agentRole: AgentRole
  systemPrompt?: string
  userPrompt: string
  maxTokens?: number
  onToken: (delta: string) => void
}

/** Streams one ai-proxy `kind: text` call, invoking onToken for each incremental delta. */
export async function streamAgentText({
  agentRole,
  systemPrompt,
  userPrompt,
  maxTokens = 200,
  onToken,
}: StreamAgentTextInput): Promise<void> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'text',
      agent_role: agentRole,
      stream: true,
      payload: {
        messages: [
          ...(systemPrompt ? [{ role: 'system', content: systemPrompt }] : []),
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
      },
    }),
  })

  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => '')
    throw new Error(`ai-proxy request failed: ${res.status} ${text}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) onToken(delta)
      } catch {
        // partial line across a chunk boundary -- ignore, rest arrives next read
      }
    }
  }
}
