// Per-PC NPC disposition (F10 SS5): the stored value, the per-scene drift budget, and the
// single writer. The guardrails themselves are pure (_shared/play/social.ts); this module is
// the persistence around them.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { cappedSceneDelta, clampDisposition } from '../_shared/play/index.ts'
import type { Json } from '../_shared/state/index.ts'
import { assertOk, logEvent } from './util.ts'

export async function dispositionMap(service: SupabaseClient, npcId: string): Promise<Record<string, number>> {
  const { data, error } = await service.from('npc_dispositions').select('character_id, value').eq('npc_id', npcId)
  assertOk(error, 'disposition load failed')
  return Object.fromEntries((data ?? []).map((d) => [d.character_id as string, Number(d.value)]))
}

/** Signed disposition movement already spent on this PC/NPC pair since the scene opened. */
async function sceneDispositionDrift(
  service: SupabaseClient,
  adventureId: string,
  npcId: string,
  characterId: string,
): Promise<number> {
  const { data: sceneStart } = await service
    .from('event_log')
    .select('id')
    .eq('adventure_id', adventureId)
    .eq('type', 'social_started')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const { data } = await service
    .from('event_log')
    .select('payload')
    .eq('adventure_id', adventureId)
    .eq('type', 'disposition_changed')
    .gt('id', (sceneStart?.id as number | undefined) ?? 0)
  return ((data ?? []) as { payload: Record<string, Json> }[])
    .filter((e) => e.payload.npc_id === npcId && e.payload.character_id === characterId)
    .reduce((sum, e) => sum + (Number(e.payload.to ?? 0) - Number(e.payload.from ?? 0)), 0)
}

export async function applyDispositionDelta(
  service: SupabaseClient,
  adventureId: string,
  sessionId: string | null,
  npcId: string,
  characterId: string,
  proposed: number,
  reason: string,
): Promise<void> {
  if (proposed === 0) return
  const delta = cappedSceneDelta(
    proposed, await sceneDispositionDrift(service, adventureId, npcId, characterId),
  )
  if (delta === 0) return
  const current = (await dispositionMap(service, npcId))[characterId] ?? 0
  const next = clampDisposition(current + delta)
  const { error } = await service.from('npc_dispositions').upsert(
    { npc_id: npcId, character_id: characterId, adventure_id: adventureId, value: next, updated_at: new Date().toISOString() },
    { onConflict: 'npc_id,character_id' },
  )
  assertOk(error, 'disposition write failed')
  await logEvent(service, adventureId, sessionId, 'disposition_changed', {
    npc_id: npcId, character_id: characterId, from: current, to: next, reason,
  })
}

