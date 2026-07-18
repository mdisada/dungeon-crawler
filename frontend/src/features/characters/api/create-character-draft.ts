import { supabase } from '@/lib/supabase'
import { emptyWizardDraft } from '../lib/empty-draft'
import { CHARACTER_COLUMNS, toCharacter, type CharacterRow } from './character-row'
import type { Character } from '../types'

// Creates a fresh, incomplete character row so the wizard has an id to save drafts against from
// step 1 onward (F02 SS3: "every step persists to a draft jsonb column so users can resume").
export async function createCharacterDraft(userId: string): Promise<Character> {
  const { data, error } = await supabase
    .from('characters')
    .insert({ user_id: userId, draft: emptyWizardDraft(), is_complete: false })
    .select(CHARACTER_COLUMNS)
    .single()
  if (error) throw error
  return toCharacter(data as unknown as CharacterRow)
}
