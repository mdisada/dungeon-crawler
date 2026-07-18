// Pure CTA validation (F03 SS3.5): what still blocks "Generate Adventure Guide".
import type { AdventureDraft } from './types'
import { CHAPTER_BOUNDS, PLAYER_BOUNDS } from './types'

export function guideRequirementsMissing(draft: AdventureDraft): string[] {
  const missing: string[] = []
  if (!draft.mode) missing.push('Choose a mode')
  if (
    draft.minPlayers < PLAYER_BOUNDS.min ||
    draft.maxPlayers > PLAYER_BOUNDS.max ||
    draft.minPlayers > draft.maxPlayers
  ) {
    missing.push('Set a valid player range')
  }
  if (!draft.type) missing.push('Choose an adventure type')
  if (draft.type === 'multi_chapter') {
    const { chaptersMin, chaptersMax } = draft
    const isValidRange =
      chaptersMin !== null &&
      chaptersMax !== null &&
      chaptersMin >= CHAPTER_BOUNDS.min &&
      chaptersMax <= CHAPTER_BOUNDS.max &&
      chaptersMin <= chaptersMax
    if (!isValidRange) missing.push('Set a valid chapter range')
  }
  if (draft.mode === 'full_ai' && !draft.difficultyPreset) missing.push('Choose a difficulty')
  if (!draft.plotIdea.trim()) missing.push('Generate a plot first, or write one')
  return missing
}
