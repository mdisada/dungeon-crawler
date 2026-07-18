export type AdventureMode = 'full_ai' | 'assist'
export type AdventureType = 'one_shot' | 'multi_chapter'
export type AdventureStatus = 'draft' | 'generating' | 'guide_ready' | 'active' | 'completed' | 'archived'

export const DIFFICULTY_PRESETS = ['easy', 'standard', 'hard', 'deadly'] as const
export type DifficultyPreset = (typeof DIFFICULTY_PRESETS)[number]

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
  }
}
