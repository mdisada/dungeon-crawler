// Which voice speaks a line, and what Fish calls it.
//
// The chain ends at the built-in default (2026-08-01): a table that has assigned no narrator is
// narrated by it rather than sitting silent, because an unset column was too easy to mistake for a
// broken feature. Silence is now the player's mute switch - a muted client never asks for synthesis
// at all - rather than an adventure-level accident. Null, and therefore `silent`, remains reachable
// if no row carries the default flag.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { createFishVoice } from '../_shared/fish.ts'

export interface ResolvedVoice {
  profileId: string
  /** Fish reference_id. Null only if registration failed, in which case Fish's default is used. */
  referenceId: string | null
}

/**
 * NPC line -> that NPC's voice -> the adventure's narrator voice -> the built-in default -> null.
 *
 * `explicitProfileId` short-circuits the chain for the TTS lab, which picks a voice directly and
 * has no adventure to fall back to.
 */
export async function resolveVoiceProfileId(
  service: SupabaseClient,
  opts: {
    adventureId: string | null
    npcId: string | null
    explicitProfileId: string | null
    callerId: string
  },
): Promise<string | null> {
  // An explicit id comes from the CLIENT (the guide's voice picker auditioning a voice, the TTS
  // lab), and everything downstream runs as the service role, which bypasses RLS. So it is checked
  // here or not at all: you may use a voice you own, or a built-in one, and nothing else. The
  // fallbacks below need no such check - adventure membership was already proven by the caller.
  if (opts.explicitProfileId) {
    const { data: profile } = await service
      .from('voice_profiles')
      .select('user_id')
      .eq('id', opts.explicitProfileId)
      .maybeSingle()
    if (!profile) throw new Error('Voice profile not found')
    const isBuiltIn = profile.user_id === null
    if (!isBuiltIn && profile.user_id !== opts.callerId) throw new Error('That voice is not yours')
    return opts.explicitProfileId
  }
  if (!opts.adventureId) return null

  if (opts.npcId) {
    const { data: npc } = await service
      .from('npcs')
      .select('voice_id')
      .eq('id', opts.npcId)
      .eq('adventure_id', opts.adventureId)
      .maybeSingle()
    if (npc?.voice_id) return npc.voice_id as string
  }

  const { data: adventure } = await service
    .from('adventures')
    .select('narrator_voice_id')
    .eq('id', opts.adventureId)
    .maybeSingle()
  const assigned = (adventure?.narrator_voice_id as string | null) ?? null
  if (assigned) return assigned

  // Nothing assigned anywhere: the built-in default narrates. One row at most carries the flag and
  // it is always ownerless, both enforced by 20260801200000_default_narrator_voice.sql.
  const { data: fallback } = await service
    .from('voice_profiles')
    .select('id')
    .eq('is_default', true)
    .maybeSingle()
  return (fallback?.id as string | null) ?? null
}

/**
 * The profile's Fish reference_id, registering the clip with Fish the first time and caching it.
 *
 * Same contract as ai-proxy's resolveFishReference, but over the service client rather than the
 * user's: the built-in voice has no owner, so a user-scoped client could read it (the builtin
 * select policy) but never write the cached id back, and every call would re-register the clip.
 */
export async function resolveFishReference(
  service: SupabaseClient,
  profileId: string,
): Promise<ResolvedVoice> {
  const { data: profile, error } = await service
    .from('voice_profiles')
    .select('name, storage_path, fish_reference_id')
    .eq('id', profileId)
    .maybeSingle()
  if (error || !profile) throw new Error(`Voice profile ${profileId} not found`)
  if (profile.fish_reference_id) {
    return { profileId, referenceId: profile.fish_reference_id as string }
  }

  const { data: clip, error: downloadError } = await service.storage
    .from('voices')
    .download(profile.storage_path as string)
  if (downloadError || !clip) throw new Error('Could not read the voice clip')

  const referenceId = await createFishVoice((profile.name as string) || 'voice', clip)
  const { error: cacheError } = await service
    .from('voice_profiles')
    .update({ fish_reference_id: referenceId })
    .eq('id', profileId)
  // A failed cache write costs a re-registration next time, not this request.
  if (cacheError) console.error('failed to cache fish_reference_id', cacheError)

  return { profileId, referenceId }
}
