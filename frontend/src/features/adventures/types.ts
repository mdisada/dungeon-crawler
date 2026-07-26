import type { DifficultyPreset, PacingOverrides } from '@rules/story/pacing'

export type AdventureMode = 'full_ai' | 'assist'
export type AdventureType = 'one_shot' | 'multi_chapter'
export type AdventureStatus = 'draft' | 'generating' | 'guide_ready' | 'active' | 'completed' | 'archived'

// The preset list and its per-knob profiles live in the rules package - the guide pipeline and the
// session runtime read the same table, so a second copy here would be a drift waiting to happen.
export { DIFFICULTY_PRESETS } from '@rules/story/pacing'
export type { DifficultyPreset, PacingOverrides } from '@rules/story/pacing'

export const PLAYER_BOUNDS = { min: 1, max: 8 } as const
export const CHAPTER_BOUNDS = { min: 2, max: 12 } as const
export const PLOT_IDEA_MAX_CHARS = 2000

/** Undo/redo snapshot stack persisted in adventures.plot_history (F03 SS3.4). */
export interface PlotHistory {
  entries: string[]
  index: number
}

export interface Adventure {
  id: string
  creatorId: string
  dmUserId: string | null
  mode: AdventureMode | null
  minPlayers: number
  maxPlayers: number
  type: AdventureType | null
  chaptersMin: number | null
  chaptersMax: number | null
  plotIdea: string
  plotHistory: PlotHistory
  status: AdventureStatus
  narratorVoiceId: string | null
  difficultyPreset: DifficultyPreset | null
  /** Only the knobs the creator moved off the preset; empty is the normal case. */
  pacingOverrides: PacingOverrides
  createdAt: string
  updatedAt: string
}

/** The wizard-editable subset of an adventure row (everything the draft autosaves). */
export interface AdventureDraft {
  mode: AdventureMode | null
  minPlayers: number
  maxPlayers: number
  type: AdventureType | null
  chaptersMin: number | null
  chaptersMax: number | null
  plotIdea: string
  plotHistory: PlotHistory
  difficultyPreset: DifficultyPreset | null
  pacingOverrides: PacingOverrides
}

export function toDraftFields(adventure: Adventure): AdventureDraft {
  return {
    mode: adventure.mode,
    minPlayers: adventure.minPlayers,
    maxPlayers: adventure.maxPlayers,
    type: adventure.type,
    chaptersMin: adventure.chaptersMin,
    chaptersMax: adventure.chaptersMax,
    plotIdea: adventure.plotIdea,
    plotHistory: adventure.plotHistory,
    difficultyPreset: adventure.difficultyPreset,
    pacingOverrides: adventure.pacingOverrides,
  }
}
