import { env } from '@/config/env'
import { callEdgeFunction } from '@/lib/edge-function'
import { supabase } from '@/lib/supabase'
import type { VoiceProfile } from '../types'

const SIGNED_URL_TTL_SECONDS = 3600
const PREVIEW_LINE = 'The tide has stopped, traveler. Sit - there is a story you need to hear.'

export async function listVoiceProfiles(): Promise<VoiceProfile[]> {
  const { data, error } = await supabase
    .from('voice_profiles')
    .select('id, name, storage_path')
    .order('created_at', { ascending: false })
  if (error) throw error
  return (data ?? []).map((v) => ({ id: v.id, name: v.name, storagePath: v.storage_path }))
}

/** Reads a clip's duration so the F04 SS5.1 3-30s bound can be enforced before upload. */
function clipDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const audio = new Audio()
    audio.preload = 'metadata'
    audio.onloadedmetadata = () => {
      URL.revokeObjectURL(url)
      resolve(audio.duration)
    }
    audio.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Could not read the audio file'))
    }
    audio.src = url
  })
}

export async function uploadVoiceProfile(userId: string, name: string, file: File): Promise<VoiceProfile> {
  const duration = await clipDuration(file)
  if (!Number.isFinite(duration) || duration < 3 || duration > 30) {
    throw new Error(`Voice clips must be 3-30 seconds (this one is ${Math.round(duration)}s)`)
  }

  const { data: profile, error: insertError } = await supabase
    .from('voice_profiles')
    .insert({ user_id: userId, name, storage_path: '' })
    .select('id')
    .single()
  if (insertError) throw insertError

  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'wav'
  const path = `${userId}/${profile.id}.${extension}`
  const { error: uploadError } = await supabase.storage
    .from('voices')
    .upload(path, file, { contentType: file.type || 'audio/wav', upsert: true })
  if (uploadError) throw uploadError

  const { error: pathError } = await supabase.from('voice_profiles').update({ storage_path: path }).eq('id', profile.id)
  if (pathError) throw pathError

  return { id: profile.id, name, storagePath: path }
}

export async function getVoiceClipUrl(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('voices').createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}

/**
 * Preview synthesis (F04 SS5.1). Placeholder mode (and any TTS failure) falls back to playing
 * the raw uploaded clip - real Voxtral cloning wiring is F12; this keeps the flow testable.
 * Returns an object URL (or signed URL) the caller can hand to an <audio> element.
 */
export async function previewVoice(profile: VoiceProfile): Promise<{ url: string; cloned: boolean }> {
  const clipUrl = await getVoiceClipUrl(profile.storagePath)
  if (env.placeholderMedia) return { url: clipUrl, cloned: false }

  try {
    const res = await callEdgeFunction('ai-proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        kind: 'tts',
        agent_role: 'user_direct',
        payload: { input: PREVIEW_LINE, voice: clipUrl, response_format: 'mp3' },
      }),
    })
    if (!res.ok) throw new Error(`tts preview failed: ${res.status}`)
    const blob = await res.blob()
    return { url: URL.createObjectURL(blob), cloned: true }
  } catch {
    return { url: clipUrl, cloned: false }
  }
}

export async function setNarratorVoice(adventureId: string, voiceProfileId: string | null): Promise<void> {
  const { error } = await supabase
    .from('adventures')
    .update({ narrator_voice_id: voiceProfileId, updated_at: new Date().toISOString() })
    .eq('id', adventureId)
  if (error) throw error
}
