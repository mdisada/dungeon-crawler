// DM story controls (Phase 5): guide NPC list for the social-scene launcher and consistency
// fact overrides. Reads ride the creator-only guide RLS; commands go through the session
// function like every other write.

import { supabase } from '@/lib/supabase'

import { callEdgeFunction } from '@/lib/edge-function'

export interface GuideNpc {
  id: string
  name: string
  generated: boolean
}

export async function fetchGuideNpcs(adventureId: string): Promise<GuideNpc[]> {
  const { data, error } = await supabase
    .from('npcs')
    .select('id, name, generated')
    .eq('adventure_id', adventureId)
    .order('created_at')
  if (error) throw new Error(error.message)
  return (data ?? []) as GuideNpc[]
}

/** Idle-nudge sweep (F08 SS9.1): the server validates idleness; 409s are the normal case. */
export async function sweepIdleNudge(adventureId: string): Promise<boolean> {
  const res = await callEdgeFunction('session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'idle_nudge', adventure_id: adventureId }),
  })
  return res.ok
}

export async function setNpcState(
  adventureId: string,
  npcId: string,
  state: 'dead' | 'alive' | 'absent',
): Promise<void> {
  const res = await callEdgeFunction('session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      action: 'player_intent',
      adventure_id: adventureId,
      kind: 'dm_command',
      command: 'set_npc_state',
      npc_id: npcId,
      state,
    }),
  })
  if (!res.ok) {
    const json = (await res.json().catch(() => ({}))) as { error?: string }
    throw new Error(json.error ?? 'Command failed')
  }
}
