import { supabase } from '@/lib/supabase'
import type { AdventureDraft } from '../types'

// Debounced autosave target (F03 SS2). `dm_user_id` mirrors the mode: the creator is the DM in
// AI-Assist, nobody is in Full-AI. `updated_at` is set explicitly so "most recent draft" ordering
// in getOrCreateAdventureDraft stays correct (no updated_at trigger on this table).
export async function saveAdventureDraft(
  adventureId: string,
  creatorId: string,
  draft: AdventureDraft,
): Promise<void> {
  const { error } = await supabase
    .from('adventures')
    .update({
      mode: draft.mode,
      dm_user_id: draft.mode === 'assist' ? creatorId : null,
      min_players: draft.minPlayers,
      max_players: draft.maxPlayers,
      type: draft.type,
      chapters_min: draft.type === 'multi_chapter' ? draft.chaptersMin : null,
      chapters_max: draft.type === 'multi_chapter' ? draft.chaptersMax : null,
      plot_idea: draft.plotIdea,
      plot_history: draft.plotHistory,
      difficulty_setting:
        draft.mode === 'full_ai' && draft.difficultyPreset ? { preset: draft.difficultyPreset } : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', adventureId)
  if (error) throw error
}
