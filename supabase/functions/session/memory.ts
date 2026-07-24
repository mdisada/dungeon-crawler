// Minimal retrieval memory (encounter-states Slice 7): encounter resolutions and scene
// summaries are embedded into memory_fragments (pgvector) and retrieved top-K at prompt
// assembly, so long-form narration stays consistent across sessions. Strictly enrichment:
// every failure degrades to "no memories", never a blocked table. Demo adventures skip it
// entirely (zero spend). Full F13 (lore-wide RAG) stays out of scope.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { callEmbedding } from '../_shared/llm.ts'
import { annotateStaleMemories } from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { loadState } from './util.ts'

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
    const memories = ((data ?? []) as { content: string }[]).map((r) => r.content)
    return await annotateStale(service, env, memories)
  } catch (err) {
    console.error('memory retrieval failed', err)
    return []
  }
}

/**
 * A memory records what was true THEN, so it is never wrong - only out of date. Retrieval was
 * handing the narrator "Elias Thorne begs you to escort him" long after Elias died, with no
 * filter against live state: we were feeding in the contradiction and then blaming the writer
 * for it. Deterministic, no model, and it annotates rather than suppresses - dropping the line
 * would lose real history and fail silently.
 */
async function annotateStale(
  service: SupabaseClient,
  env: AgentEnv,
  memories: string[],
): Promise<string[]> {
  if (memories.length === 0) return memories
  const { data } = await service
    .from('npcs')
    .select('id, name, initial_state')
    .eq('adventure_id', env.adventureId)
  const rows = (data ?? []) as { id: string; name: string; initial_state: string | null }[]
  if (rows.length === 0) return memories
  const live = (await loadState(service, env.adventureId)).state.dm?.facts.npcStates ?? {}
  return annotateStaleMemories(
    memories,
    rows.map((n) => ({ name: n.name, state: live[n.id] ?? n.initial_state ?? 'alive' })),
  )
}
