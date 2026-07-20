// Minimal retrieval memory (encounter-states Slice 7): encounter resolutions and scene
// summaries are embedded into memory_fragments (pgvector) and retrieved top-K at prompt
// assembly, so long-form narration stays consistent across sessions. Strictly enrichment:
// every failure degrades to "no memories", never a blocked table. Demo adventures skip it
// entirely (zero spend). Full F13 (lore-wide RAG) stays out of scope.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { callEmbedding } from '../_shared/llm.ts'
import type { AgentEnv } from './agents.ts'

const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY') ?? ''

export type MemoryKind = 'encounter' | 'scene_summary'

export async function writeMemoryFragment(
  service: SupabaseClient,
  env: AgentEnv,
  kind: MemoryKind,
  content: string,
): Promise<void> {
  if (env.demo || !content.trim()) return
  try {
    const vector = await callEmbedding({
      serviceClient: service,
      openRouterApiKey: OPENROUTER_API_KEY,
      userId: env.creatorId,
      adventureId: env.adventureId,
      input: content,
    })
    const { error } = await service.from('memory_fragments').insert({
      adventure_id: env.adventureId,
      kind,
      content: content.slice(0, 2000),
      embedding: JSON.stringify(vector),
    })
    if (error) console.error('memory fragment insert failed', error)
  } catch (err) {
    console.error('memory fragment embed failed', err)
  }
}

/** Top-K memory lines for prompt assembly ("Established earlier: ..."). Failures return []. */
export async function retrieveMemories(
  service: SupabaseClient,
  env: AgentEnv,
  queryText: string,
  k = 4,
): Promise<string[]> {
  if (env.demo || !queryText.trim()) return []
  try {
    const vector = await callEmbedding({
      serviceClient: service,
      openRouterApiKey: OPENROUTER_API_KEY,
      userId: env.creatorId,
      adventureId: env.adventureId,
      input: queryText,
    })
    const { data, error } = await service.rpc('match_memory_fragments', {
      p_adventure_id: env.adventureId,
      p_query: JSON.stringify(vector),
      p_k: k,
    })
    if (error) {
      console.error('memory retrieval failed', error)
      return []
    }
    return ((data ?? []) as { content: string }[]).map((r) => r.content)
  } catch (err) {
    console.error('memory retrieval failed', err)
    return []
  }
}
