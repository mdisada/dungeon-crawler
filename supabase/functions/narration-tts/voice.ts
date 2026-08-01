// Which voice speaks a line, and what Fish calls it.
//
// The fallback chain is the whole feature's opt-in switch: an adventure with no narrator voice
// assigned resolves to null, narration-tts returns `silent`, and play behaves exactly as it did
// before this feature existed - no synthesis, no cost, no gate.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { createFishVoice } from '../_shared/fish.ts'

export interface ResolvedVoice {
  profileId: string
  /** Fish reference_id. Null only if registration failed, in which case Fish's default is used. */
  referenceId: string | null
}

/**
 * NPC line -> that NPC's voice -> else the adventure's narrator voice -> else null (silent).
 *
 * `explicitProfileId` short-circuits the chain for the TTS lab, which picks a voice directly and
 * has no adventure to fall back to.
 */
export async function resolveVoiceProfileId(
  service: SupabaseClient,
  opts: { adventureId: string | null; npcId: string | null; explicitProfileId: string | null },
): Promise<string | null> {
  if (opts.explicitProfileId) return opts.explicitProfileId
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
  return (adventure?.narrator_voice_id as string | null) ?? null
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
