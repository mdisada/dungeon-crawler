import { callEdgeFunction } from '@/lib/edge-function'
import type { AdventureType } from '../types'

export interface PlotAiContext {
  type: AdventureType
  chaptersMin: number | null
  chaptersMax: number | null
}

// F03 SS5: both plot calls run as `agent_role: story_director` through ai-proxy, non-streaming
// (short one-shot generations behind a spinner, same as F02's background narrative). The spec's
// contract output is `{ plot: string }`; we ask for the plot as plain prose instead of JSON so
// no structured-output support is required of the routed model.
async function callStoryDirector(systemPrompt: string, userPrompt: string): Promise<string> {
  const res = await callEdgeFunction('ai-proxy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'text',
      agent_role: 'story_director',
      stream: false,
      payload: {
        messages: [
          { role: 'system', content: systemPrompt },
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
  return content.trim()
}

function describeAdventureShape(context: PlotAiContext): string {
  if (context.type === 'one_shot') {
    return 'Adventure type: a one-shot - a single self-contained adventure told in one session.'
  }
  const range =
    context.chaptersMin !== null && context.chaptersMax !== null
      ? `${context.chaptersMin}-${context.chaptersMax} chapters`
      : 'several chapters'
  return `Adventure type: a multi-chapter campaign spanning ${range}.`
}

export async function generatePlot(context: PlotAiContext): Promise<string> {
  return callStoryDirector(
    'You are the Story Director for a tabletop RPG platform. Invent a plot premise for a new ' +
      'adventure in 3-6 sentences covering premise, genre, hook, stakes, and tone. Output only ' +
      'the plot text - no headings, no lists, no preamble.',
    describeAdventureShape(context),
  )
}

export async function improvePlot(context: PlotAiContext, currentPlot: string): Promise<string> {
  return callStoryDirector(
    'You are the Story Director for a tabletop RPG platform. Rewrite the plot idea the user ' +
      'gives you: sharpen the hook and raise the stakes while keeping the user\'s core intent ' +
      'and a similar length. You must retain every proper noun from the input unless it is ' +
      'clearly misspelled. Output only the rewritten plot text - no headings, no preamble.',
    `${describeAdventureShape(context)}\n\nPlot idea to improve:\n${currentPlot}`,
  )
}
