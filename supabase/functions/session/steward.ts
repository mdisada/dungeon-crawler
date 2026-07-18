// Meta Loop Steward (F08 SS8): the antagonist's off-screen agenda (advancing on world-clock
// ticks and session end, surfacing as non-blocking proposals whose accepted form is a rumor
// ingredient) and the suspicion tally behind BBEG commitment. Keyword tagging for suspicion is
// the SS11 starting heuristic; the Summarizer refines it later.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { recordProposal } from './proposals.ts'
import { runSteward } from './story-agents.ts'
import { assertOk, loadState, logEvent } from './util.ts'

interface MetaLoopRow {
  adventure_id: string
  antagonist_plan: { steps: { summary: string; status: string }[]; current_step: number }
  committed_bbeg_npc_id: string | null
  suspicion_tally: Record<string, number>
}

export async function ensureMetaLoop(service: SupabaseClient, env: AgentEnv): Promise<MetaLoopRow> {
  const { data, error } = await service
    .from('meta_loop')
    .select('adventure_id, antagonist_plan, committed_bbeg_npc_id, suspicion_tally')
    .eq('adventure_id', env.adventureId)
    .maybeSingle()
  assertOk(error, 'meta loop load failed')
  if (data) return data as MetaLoopRow

  const { data: adventure } = await service
    .from('adventures')
    .select('meta_loop')
    .eq('id', env.adventureId)
    .single()
  const authored = (adventure?.meta_loop ?? {}) as Record<string, Json>
  const row = {
    adventure_id: env.adventureId,
    arc_summary: String(authored.arc ?? ''),
    entry_point: String(authored.premise ?? ''),
    antagonist_plan: { steps: [], current_step: 0 } as unknown as Json,
    suspicion_tally: {} as unknown as Json,
  }
  const { error: insertError } = await service.from('meta_loop').insert(row)
  assertOk(insertError, 'meta loop insert failed')
  return {
    adventure_id: env.adventureId,
    antagonist_plan: { steps: [], current_step: 0 },
    committed_bbeg_npc_id: null,
    suspicion_tally: {},
  }
}

/**
 * Antagonist turn (F08 SS8): world-clock ticks (advance_day) and session end. The plan
 * advances regardless of player presence; the surfacing suggestion becomes a rumor ingredient
 * (auto-applied in full-AI, pending proposal in assist).
 */
export async function antagonistTurn(service: SupabaseClient, env: AgentEnv, sessionId: string, trigger: string): Promise<void> {
  const meta = await ensureMetaLoop(service, env)
  const { data: adventure } = await service.from('adventures').select('meta_loop').eq('id', env.adventureId).single()
  const antagonist = String(((adventure?.meta_loop ?? {}) as Record<string, Json>).antagonist ?? 'the antagonist')

  const { data: recent } = await service
    .from('event_log')
    .select('type, payload')
    .eq('adventure_id', env.adventureId)
    .order('id', { ascending: false })
    .limit(10)
  const partyImpact = ((recent ?? []) as { type: string; payload: Record<string, Json> }[])
    .map((e) => `${e.type}: ${['text', 'title', 'tag'].map((k) => e.payload[k]).filter((v) => typeof v === 'string').join(' ')}`)

  const turn = await runSteward(env, antagonist, meta.antagonist_plan, partyImpact)

  const plan = meta.antagonist_plan
  plan.steps.push({ summary: turn.offScreenEvent, status: turn.stepProgress === 'advance' ? 'done' : turn.stepProgress })
  if (turn.stepProgress === 'advance') plan.current_step += 1
  const { error } = await service
    .from('meta_loop')
    .update({ antagonist_plan: plan as unknown as Json, updated_at: new Date().toISOString() })
    .eq('adventure_id', env.adventureId)
  assertOk(error, 'meta loop update failed')

  const auto = env.mode === 'full_ai'
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'antagonist_turn',
    payload: turn as unknown as Json,
    mode: auto ? 'auto' : 'human',
    summary: `Off-screen: ${turn.offScreenEvent.slice(0, 60)}`,
  })
  await logEvent(service, env.adventureId, sessionId, 'antagonist_advanced', {
    trigger, step_progress: turn.stepProgress, off_screen_event: turn.offScreenEvent,
  })
  if (auto) {
    // Accepted surfacing becomes an undiscovered rumor ingredient the Weaver/NPCs can place.
    const { error: ingredientError } = await service.from('ingredients').insert({
      adventure_id: env.adventureId,
      type: 'rumor',
      content: { text: turn.surfaceText } as unknown as Json,
      reveals: turn.surfaceText,
      pillar_tags: ['social'],
      placement: {} as unknown as Json,
      canon_source: 'generated',
    })
    assertOk(ingredientError, 'surfacing ingredient insert failed')
  }
}

const SUSPICION_WORDS = /(suspect|suspicious|liar|lying|lies|hiding something|can'?t trust|don'?t trust|behind this|working with|traitor|villain)/

/** BBEG commitment threshold (F08 SS8): tally >= 5 across >= 2 sessions of signals. */
export const BBEG_TALLY_THRESHOLD = 5

/**
 * Suspicion tagging on player utterances (starting heuristic per F08 SS11): a registry NPC
 * named alongside hostile/suspicious language bumps their tally. At threshold, the BBEG
 * commitment proposal fires - full-AI commits only if the NPC's state doesn't contradict it.
 */
export async function noteSuspicion(service: SupabaseClient, env: AgentEnv, sessionId: string, utterance: string): Promise<void> {
  if (!SUSPICION_WORDS.test(utterance.toLowerCase())) return
  const { data: npcs } = await service.from('npcs').select('id, name, generated').eq('adventure_id', env.adventureId)
  const mentioned = ((npcs ?? []) as { id: string; name: string; generated: boolean }[])
    .filter((n) => !n.generated && n.name && utterance.toLowerCase().includes(n.name.toLowerCase()))
  if (mentioned.length === 0) return

  const meta = await ensureMetaLoop(service, env)
  if (meta.committed_bbeg_npc_id) return
  const tally = { ...meta.suspicion_tally }
  for (const npc of mentioned) {
    tally[npc.id] = (tally[npc.id] ?? 0) + 1
    await logEvent(service, env.adventureId, sessionId, 'suspicion_noted', {
      npc_id: npc.id, name: npc.name, tally: tally[npc.id],
    })
  }
  const { error } = await service
    .from('meta_loop')
    .update({ suspicion_tally: tally as unknown as Json, updated_at: new Date().toISOString() })
    .eq('adventure_id', env.adventureId)
  assertOk(error, 'suspicion tally update failed')

  const [topId, topScore] = Object.entries(tally).sort((a, b) => b[1] - a[1])[0]
  if (topScore < BBEG_TALLY_THRESHOLD) return
  const { count: sessionCount } = await service
    .from('sessions')
    .select('id', { count: 'exact', head: true })
    .eq('adventure_id', env.adventureId)
  if ((sessionCount ?? 0) < 2) return

  const topNpc = ((npcs ?? []) as { id: string; name: string }[]).find((n) => n.id === topId)
  if (!topNpc) return
  const state = (await loadState(service, env.adventureId)).state
  const npcState = state.dm?.facts.npcStates[topId]
  const auto = env.mode === 'full_ai' && npcState !== 'dead'
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'bbeg_commitment',
    payload: { npc_id: topId, name: topNpc.name, tally: topScore },
    mode: auto ? 'auto' : 'human',
    summary: `Commit ${topNpc.name} as the antagonist's agent (suspicion ${topScore})`,
  })
  if (!auto) return
  const { error: commitError } = await service
    .from('meta_loop')
    .update({ committed_bbeg_npc_id: topId, updated_at: new Date().toISOString() })
    .eq('adventure_id', env.adventureId)
  assertOk(commitError, 'bbeg commit failed')
  await logEvent(service, env.adventureId, sessionId, 'bbeg_committed', { npc_id: topId, name: topNpc.name, tally: topScore })
  // Hook Weaver retro-pass seed: the commitment must surface in play, never be announced.
  const { data: objective } = await service
    .from('objectives')
    .select('id')
    .eq('adventure_id', env.adventureId)
    .eq('reveal_state', 'active')
    .limit(1)
    .maybeSingle()
  if (objective) {
    await service.from('hooks').insert({
      adventure_id: env.adventureId,
      from_ref: { table: 'npcs', id: topId } as unknown as Json,
      to_objective_id: objective.id,
      hook_text: `${topNpc.name}'s fingerprints are quietly on recent events - let small details confirm the party's suspicion without announcing it.`,
      kind: 'npc_objective',
    })
  }
}
