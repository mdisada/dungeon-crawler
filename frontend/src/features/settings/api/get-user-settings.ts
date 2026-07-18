import { supabase } from '@/lib/supabase'
import type { UserSettings } from '../types'

interface UserSettingsRow {
  user_id: string
  provider: 'openrouter' | 'local'
  model_map: Record<string, string>
  tts_model: string
  image_model: string
  embedding_model: string
  byok_local_storage: boolean
  updated_at: string
}

function toUserSettings(row: UserSettingsRow): UserSettings {
  return {
    userId: row.user_id,
    provider: row.provider,
    modelMap: row.model_map,
    ttsModel: row.tts_model,
    imageModel: row.image_model,
    embeddingModel: row.embedding_model,
    byokLocalStorage: row.byok_local_storage,
    updatedAt: row.updated_at,
  }
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const { data, error } = await supabase
    .from('user_settings')
    .select('user_id, provider, model_map, tts_model, image_model, embedding_model, byok_local_storage, updated_at')
    .eq('user_id', userId)
    .maybeSingle()

  if (error) throw error
  // Self-heal: accounts created before the provisioning trigger have no row. Insert a default one
  // (own-row INSERT policy allows this) and re-read it.
  if (!data) {
    const { data: inserted, error: insertError } = await supabase
      .from('user_settings')
      .insert({ user_id: userId })
      .select('user_id, provider, model_map, tts_model, image_model, embedding_model, byok_local_storage, updated_at')
      .single()
    if (insertError) throw insertError
    return toUserSettings(inserted)
  }
  return toUserSettings(data)
}
