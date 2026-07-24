import { supabase } from '@/lib/supabase'

// Voice *clips* (list / upload / normalize / preview) moved to features/tts once both generation
// routes needed them - import them from that feature's barrel. What stays here is narrator
// assignment, which is adventure domain rather than TTS domain.

export async function setNarratorVoice(adventureId: string, voiceProfileId: string | null): Promise<void> {
  const { error } = await supabase
    .from('adventures')
    .update({ narrator_voice_id: voiceProfileId, updated_at: new Date().toISOString() })
    .eq('id', adventureId)
  if (error) throw error
}
