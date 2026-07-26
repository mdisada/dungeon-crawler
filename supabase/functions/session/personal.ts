// Personal arcs at play time (overhaul 2026-07-26): evaluate each bound character's private
// objective, pay it exactly once, and surface the result.
//
// Deliberately small and deterministic. Personal atoms are barred from every structural position
// by the stage-8 lint, so nothing here can move the spine - the worst failure mode is a reward
// that does not land, never a story that cannot finish. No judge, no LLM: the same
// `evaluatePredicate` the main ladder uses, over the same committed flags.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { evaluatePredicate } from '../_shared/story/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

interface BindingRow {
  id: string
  character_id: string
  objective: { label?: string; predicate?: unknown; reward?: { gold?: number; boon?: string } } | null
  status: string
  reward_paid_at: string | null
}

/** The player-visible shape mirrored onto players.list[].personal. */
function stakeView(row: BindingRow, status: 'active' | 'completed' | 'failed') {
  const reward = row.objective?.reward ?? {}
  const bits = [reward.gold ? `${reward.gold} gp` : '', reward.boon ?? ''].filter(Boolean)
  return {
    objectiveLabel: row.objective?.label ?? '',
    status,
    reward: bits.join(', '),
  }
}

/**
 * Runs after any milestone write. Cheap: one indexed read, and it exits immediately for the
 * (common) adventure with no bindings at all.
 */
export async function applyPersonalProgress(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
): Promise<void> {
  const { data, error } = await service
    .from('personal_bindings')
    .select('id, character_id, objective, status, reward_paid_at')
    .eq('adventure_id', env.adventureId)
    .eq('status', 'active')
  if (error || (data ?? []).length === 0) return

  const state = (await loadState(service, env.adventureId)).state
  const flags = state.dm?.facts.flags ?? {}
  const world = state.dm?.facts.world ?? {}
  const { data: eventRows } = await service
    .from('event_log').select('payload').eq('adventure_id', env.adventureId).eq('type', 'story_event')
  const events = new Set(
    ((eventRows ?? []) as { payload: Record<string, unknown> | null }[])
      .map((e) => (typeof e.payload?.tag === 'string' ? e.payload.tag : ''))
      .filter(Boolean),
  )

  for (const row of (data ?? []) as BindingRow[]) {
    const predicate = row.objective?.predicate
    if (!predicate) continue
    if (!evaluatePredicate(predicate, { facts: world, flags, events })) continue

    // Idempotent payout, mirroring quest_offers.paid_at: the claim is conditional on the guard
    // still being null, so two concurrent progress passes cannot double-pay.
    const { data: claimed } = await service
      .from('personal_bindings')
      .update({ status: 'completed', reward_paid_at: new Date().toISOString() })
      .eq('id', row.id)
      .is('reward_paid_at', null)
      .select('id')
    if ((claimed ?? []).length === 0) continue

    const gold = Math.max(0, Math.floor(row.objective?.reward?.gold ?? 0))
    await commitDiffs(service, env.adventureId, (s) => [
      ...(gold > 0
        ? [{ domain: 'players' as const, patch: { gold: (s.players.gold ?? 0) + gold } as Json }]
        : []),
      {
        domain: 'players' as const,
        patch: {
          list: s.players.list.map((p) =>
            p.characterId === row.character_id
              ? { ...p, personal: { ...(p.personal ?? { intro: '' }), ...stakeView(row, 'completed') } }
              : p),
        } as unknown as Json,
      },
    ])

    await logEvent(service, env.adventureId, sessionId, 'personal_objective_completed', {
      character_id: row.character_id,
      label: row.objective?.label ?? '',
      gold, boon: row.objective?.reward?.boon ?? null,
    })
  }
}

/** Personal outcomes for the climax author, so private arcs pay off in the epilogue prose. */
export async function personalEpilogueLines(
  service: SupabaseClient,
  adventureId: string,
): Promise<string[]> {
  const { data } = await service
    .from('personal_bindings')
    .select('character_id, objective, status')
    .eq('adventure_id', adventureId)
  const rows = (data ?? []) as BindingRow[]
  if (rows.length === 0) return []
  const { data: chars } = await service
    .from('characters').select('id, name').in('id', rows.map((r) => r.character_id))
  const nameById = new Map(((chars ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]))
  return rows.map((r) =>
    `${nameById.get(r.character_id) ?? 'A companion'}: "${r.objective?.label ?? 'a private matter'}" - ${
      r.status === 'completed' ? 'resolved' : r.status === 'failed' ? 'lost' : 'left unfinished'
    }.`)
}
