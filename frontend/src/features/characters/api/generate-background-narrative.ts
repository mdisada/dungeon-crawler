import { callEdgeFunction } from '@/lib/edge-function'
import type { Physical } from '../types'

export interface GenerateNarrativeInput {
  raceName: string
  className: string
  backgroundName: string
  freeformText: string
  physical: Physical
}

// F02 SS5: one-shot ai-proxy `kind: text`, `agent_role: user_direct` call merging freeform +
// physical + background into 2-3 paragraphs of prose. Non-streaming (the wizard shows a spinner,
// not incremental tokens, for this short one-shot generation).
export async function generateBackgroundNarrative(input: GenerateNarrativeInput): Promise<string> {
  const userPrompt = [
    `Race: ${input.raceName}`,
    `Class: ${input.className}`,
    `Background: ${input.backgroundName}`,
    input.physical.description ? `Appearance: ${input.physical.description}` : null,
    [input.physical.age, input.physical.height, input.physical.hair, input.physical.eyes]
      .filter(Boolean)
      .join(', '),
    input.freeformText ? `Uniqueness notes: ${input.freeformText}` : null,
  ]
    .filter(Boolean)
    .join('\n')

  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'text',
      agent_role: 'user_direct',
      stream: false,
      payload: {
        messages: [
          {
            role: 'system',
            content:
              'Write a 2-3 paragraph character background narrative in second person, merging the ' +
              'given mechanical background with the freeform notes and appearance. No headings.',
          },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 500,
      },
    }),
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`ai-proxy text request failed: ${res.status} ${text}`)
  }

  const json = await res.json()
  const content: string | undefined = json.choices?.[0]?.message?.content
  if (!content) throw new Error('ai-proxy text response had no content')
  return content
}
