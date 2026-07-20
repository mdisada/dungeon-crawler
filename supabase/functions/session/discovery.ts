// Location-placed clue discovery. The NPC reveal gate (npc-dialogue.ts) is the only other
// writer of ingredients.discovered, and it refuses location placements by design - so before
// this module, physical evidence authored into a room could never be found by searching it.
// A successful attempt in the right room is the entitlement; the gate in _shared/play decides.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { filterLocationReveals } from '../_shared/play/index.ts'
import type { RevealCandidate } from '../_shared/play/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { assertOk, logEvent } from './util.ts'

export interface DiscoveryContext {
  locationId: string | null
  actorCharacterId: string
  checkPassed: boolean
}

/** One clue per successful attempt - a single search must not dump the whole case file. */
const MAX_PER_ATTEMPT = 1

/**
 * Marks up to one undiscovered location-placed ingredient found, and returns its `reveals`
 * text so the caller can ground the narration on real authored evidence instead of inventing
 * detail. Best-effort: discovery must never break the action it rides on.
 */
export async function discoverAtLocation(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string | null,
  ctx: DiscoveryContext,
): Promise<string[]> {
  if (!ctx.checkPassed || !ctx.locationId) return []

  const { data, error } = await service
    .from('ingredients')
    .select('id, reveals, placement, reveals_to, discovered')
    .eq('adventure_id', env.adventureId)
    .eq('discovered', false)
    .eq('placement->>location_id', ctx.locationId)
    .order('created_at')
  assertOk(error, 'location clue load failed')

  const rows = (data ?? []).map((row) => {
    const placement = (row.placement ?? {}) as Record<string, Json>
    const revealsTo = (row.reveals_to ?? {}) as Record<string, Json>
    const candidate: RevealCandidate = {
      id: row.id as string,
      npcId: (placement.npc_id as string) ?? null,
      locationId: (placement.location_id as string) ?? null,
      condition: (placement.condition as string) ?? null,
      discovered: Boolean(row.discovered),
      boundCharacterId: (revealsTo.character_id as string) ?? null,
      anyPc: revealsTo.any_pc === true,
    }
    return { candidate, reveals: (row.reveals as string) ?? '' }
  })

  const { allowed } = filterLocationReveals(rows.map((r) => r.candidate), ctx)
  const found = rows.filter((r) => allowed.includes(r.candidate.id)).slice(0, MAX_PER_ATTEMPT)
  if (found.length === 0) return []

  const ids = found.map((f) => f.candidate.id)
  const { error: updateError } = await service.from('ingredients').update({ discovered: true }).in('id', ids)
  assertOk(updateError, 'ingredient discover failed')
  for (const id of ids) {
    await logEvent(service, env.adventureId, sessionId, 'ingredient_revealed', {
      ingredient_id: id, location_id: ctx.locationId, to: ctx.actorCharacterId, source: 'location_search',
    })
  }
  return found.map((f) => f.reveals).filter(Boolean)
}

/** The narration-prompt fragment for what a successful attempt turned up (empty when nothing). */
export function discoveryNote(reveals: string[]): string {
  if (reveals.length === 0) return ''
  return ` They uncover authored evidence here - work it into the description exactly as it stands, ` +
    `revealing nothing beyond it: ${reveals.join(' | ')}.`
}
