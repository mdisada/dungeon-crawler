import { supabase } from '@/lib/supabase'
import type { Provider } from '../types'

export interface UpdateUserSettingsInput {
  provider?: Provider
  modelMap?: Record<string, string>
  ttsModel?: string
  imageModel?: string
  byokLocalStorage?: boolean
}

export async function updateUserSettings(userId: string, input: UpdateUserSettingsInput): Promise<void> {
  const { error } = await supabase
    .from('user_settings')
    .update({
      ...(input.provider !== undefined ? { provider: input.provider } : {}),
      ...(input.modelMap !== undefined ? { model_map: input.modelMap } : {}),
      ...(input.ttsModel !== undefined ? { tts_model: input.ttsModel } : {}),
      ...(input.imageModel !== undefined ? { image_model: input.imageModel } : {}),
      ...(input.byokLocalStorage !== undefined ? { byok_local_storage: input.byokLocalStorage } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId)

  if (error) throw error
}
