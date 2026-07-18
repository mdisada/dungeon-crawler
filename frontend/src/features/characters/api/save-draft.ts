import { supabase } from '@/lib/supabase'
import type { WizardDraft } from '../types'

// Called after every wizard step (F02 SS3). Also mirrors name/race/class onto their real columns
// as they're chosen, purely so the Character Select sidebar (F02 SS2) can show something useful
// for in-progress characters without waiting for Review & Save.
export async function saveDraft(characterId: string, draft: WizardDraft): Promise<void> {
  const { error } = await supabase
    .from('characters')
    .update({
      draft,
      name: draft.name,
      race_key: draft.raceKey,
      class_key: draft.classKey,
    })
    .eq('id', characterId)
  if (error) throw error
}
