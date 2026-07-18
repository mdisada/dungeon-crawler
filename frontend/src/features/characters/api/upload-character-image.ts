import { supabase } from '@/lib/supabase'

export type CharacterImageKind = 'fullbody' | 'avatar' | 'token' | 'portrait'

const SIGNED_URL_TTL_SECONDS = 3600

// The `characters` Storage bucket is private (owner-scoped RLS - see the characters migration),
// so callers store the returned *path* in characters.images, not a URL, and resolve it to a
// signed URL at render time via getCharacterImageUrl below.
export async function uploadCharacterImage(
  characterId: string,
  kind: CharacterImageKind,
  blob: Blob,
): Promise<string> {
  const path = `${characterId}/${kind}.png`
  const { error } = await supabase.storage
    .from('characters')
    .upload(path, blob, { contentType: 'image/png', upsert: true })
  if (error) throw error
  return path
}

// Voice sample clip for this character (cloning against the TTS provider is Phase 3 / F12 work;
// this only stores the sample in the same owner-scoped folder as the images).
export async function uploadCharacterVoiceClip(characterId: string, file: File): Promise<string> {
  const extension = file.name.split('.').pop()?.toLowerCase() ?? 'mp3'
  const path = `${characterId}/voice-sample.${extension}`
  const { error } = await supabase.storage
    .from('characters')
    .upload(path, file, { contentType: file.type || 'audio/mpeg', upsert: true })
  if (error) throw error
  return path
}

export async function getCharacterImageUrl(path: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from('characters')
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS)
  if (error) throw error
  return data.signedUrl
}
