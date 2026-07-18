import { normalizePlotHistory } from '../plot-history'
import type { Adventure, AdventureMode, AdventureStatus, AdventureType, DifficultyPreset } from '../types'
import { DIFFICULTY_PRESETS } from '../types'

// Shared row shape + mapper for adventures.* CRUD calls, mirroring characters/api/character-row.ts.
export interface AdventureRow {
  id: string
  creator_id: string
  dm_user_id: string | null
  mode: AdventureMode | null
  min_players: number
  max_players: number
  type: AdventureType | null
  chapters_min: number | null
  chapters_max: number | null
  plot_idea: string
  plot_history: unknown
  status: AdventureStatus
  narrator_voice_id: string | null
  difficulty_setting: { preset?: string } | null
  created_at: string
  updated_at: string
}

export const ADVENTURE_COLUMNS =
  'id, creator_id, dm_user_id, mode, min_players, max_players, type, chapters_min, chapters_max, ' +
  'plot_idea, plot_history, status, narrator_voice_id, difficulty_setting, created_at, updated_at'

function toDifficultyPreset(setting: AdventureRow['difficulty_setting']): DifficultyPreset | null {
  const preset = setting?.preset
  return DIFFICULTY_PRESETS.includes(preset as DifficultyPreset) ? (preset as DifficultyPreset) : null
}

export function toAdventure(row: AdventureRow): Adventure {
  return {
    id: row.id,
    creatorId: row.creator_id,
    dmUserId: row.dm_user_id,
    mode: row.mode,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    type: row.type,
    chaptersMin: row.chapters_min,
    chaptersMax: row.chapters_max,
    plotIdea: row.plot_idea,
    plotHistory: normalizePlotHistory(row.plot_history, row.plot_idea),
    status: row.status,
    narratorVoiceId: row.narrator_voice_id,
    difficultyPreset: toDifficultyPreset(row.difficulty_setting),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
