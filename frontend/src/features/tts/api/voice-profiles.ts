import { supabase } from '@/lib/supabase'
import { normalizeVoiceClip } from '../normalize-clip'
import type { VoiceProfile } from '../types'

// Voice clips keep living in the existing private `voices` bucket and voice_profiles table
// (F04 SS5.1) -- features/tts took over creating and reading them because both generation routes
// need them; features/guide keeps narrator *assignment*, which is adventure domain.
const VOICES_BUCKET = 'voices'
const SIGNED_URL_TTL_SECONDS = 3600

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  const { data, error } = await supabase
    .from('voice_profiles')
    .select('id, name, storage_path')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((row) => ({ id: row.id, name: row.name, storagePath: row.storage_path }))
}

export async function getVoiceClipUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(VOICES_BUCKET)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

/** Normalizes to 16 kHz mono WAV (cropping past 15s) before storing, so every route gets one shape. */
export async function uploadVoiceProfile(userId: string, name: string, file: File): Promise<VoiceProfile> {
  const { blob } = await normalizeVoiceClip(file)

  const { data: profile, error: insertError } = await supabase
    .from('voice_profiles')
    .insert({ user_id: userId, name, storage_path: '' })
    .select('id')
    .single()
  if (insertError) throw insertError

  const path = `${userId}/${profile.id}.wav`
  const { error: uploadError } = await supabase.storage
    .from(VOICES_BUCKET)
    .upload(path, blob, { contentType: 'audio/wav', upsert: true })
  if (uploadError) throw uploadError

  const { error: pathError } = await supabase
    .from('voice_profiles')
    .update({ storage_path: path })
    .eq('id', profile.id)
  if (pathError) throw pathError

  return { id: profile.id, name, storagePath: path }
}

export async function deleteVoiceProfile(profile: VoiceProfile): Promise<void> {
  const { error } = await supabase.from('voice_profiles').delete().eq('id', profile.id)
  if (error) throw error
  if (profile.storagePath) {
    await supabase.storage.from(VOICES_BUCKET).remove([profile.storagePath])
  }
}
