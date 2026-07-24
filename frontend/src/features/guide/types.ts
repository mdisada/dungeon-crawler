// Row shapes for the F04 guide editor, camelCased from the guide content tables.

import type { Cell } from '@rules/combat'
import type { NpcStatBlock } from '@rules/guide'

import type { MapImageFit, Spawns } from '@/features/map-editor'

export interface StoryDial {
  key: string
  name: string
  description: string
}

export interface GuideAdventure {
  id: string
  status: 'draft' | 'generating' | 'guide_ready' | 'active' | 'completed' | 'archived'
  mode: 'full_ai' | 'assist' | null
  minPlayers: number
  maxPlayers: number
  type: 'one_shot' | 'multi_chapter' | null
  plotIdea: string
  narratorVoiceId: string | null
  metaLoop: { premise: string; antagonist: string; stakes: string; arc: string } | null
  storyDials: StoryDial[]
}

export interface Chapter {
  id: string
  index: number
  title: string
  arcSummary: string
  humanEdited: boolean
  pendingRegen: Record<string, unknown> | null
}

export interface Objective {
  id: string
  chapterId: string
  index: number
  title: string
  hiddenDescription: string
  completionPredicates: unknown
  revealState: 'hidden' | 'revealed' | 'active' | 'completed'
  linkedNpcIds: string[]
  linkedLocationIds: string[]
  encounterIds: string[]
  humanEdited: boolean
  pendingRegen: Record<string, unknown> | null
}

export interface Npc {
  id: string
  chapterId: string | null
  name: string
  role: 'npc' | 'boss'
  personality: Record<string, unknown>
  faction: string
  voiceId: string | null
  imagePrompt: string
  images: Partial<Record<'fullbody' | 'avatar' | 'token' | 'portrait', string>>
  description: string
  statBlock: NpcStatBlock | null
  humanEdited: boolean
  pendingRegen: Record<string, unknown> | null
}

/**
 * A location's battle map (stored inline on locations.map, in the adventure-media bucket). Widened
 * to the rich authoring shape (grid size, image-fit, party/enemy spawns) shared with the standalone
 * map library. The play runtime (session/state.ts) reads only imagePath + obstacles, so the extra
 * fields are authored-and-forward-compatible.
 */
export interface BattleMap {
  imagePath: string | null
  gridCols: number
  gridRows: number
  imageWidth: number | null
  imageHeight: number | null
  imageFit: MapImageFit
  obstacles: Cell[]
  spawns: Spawns
}

export const DEFAULT_BATTLE_MAP: BattleMap = {
  imagePath: null, gridCols: 32, gridRows: 32, imageWidth: null, imageHeight: null,
  imageFit: 'fill', obstacles: [], spawns: { party: [], enemy: [] },
}

const asCells = (v: unknown): Cell[] =>
  Array.isArray(v)
    ? v.filter((c): c is Cell => Array.isArray(c) && c.length === 2 && typeof c[0] === 'number' && typeof c[1] === 'number')
    : []

/** Reads a raw locations.map jsonb into the rich shape, upgrading legacy flat data on the fly. */
export function normalizeBattleMap(raw: unknown): BattleMap | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const m = raw as Record<string, unknown>
  const rawSpawns = m.spawns
  const spawns: Spawns = Array.isArray(rawSpawns)
    ? { party: asCells(rawSpawns), enemy: [] } // legacy flat spawns -> party side
    : {
        party: asCells((rawSpawns as Record<string, unknown> | undefined)?.party),
        enemy: asCells((rawSpawns as Record<string, unknown> | undefined)?.enemy),
      }
  const fit = m.imageFit
  return {
    imagePath: typeof m.imagePath === 'string' ? m.imagePath : null,
    gridCols: typeof m.gridCols === 'number' ? m.gridCols : 32,
    gridRows: typeof m.gridRows === 'number' ? m.gridRows : 32,
    imageWidth: typeof m.imageWidth === 'number' ? m.imageWidth : null,
    imageHeight: typeof m.imageHeight === 'number' ? m.imageHeight : null,
    imageFit: fit === 'cover' || fit === 'contain' ? fit : 'fill',
    obstacles: asCells(m.obstacles),
    spawns,
  }
}

export interface LocationRow {
  id: string
  chapterId: string | null
  name: string
  description: string
  imagePrompt: string
  backgroundPath: string | null
  previousBackgroundPaths: string[]
  map: BattleMap | null
  humanEdited: boolean
  pendingRegen: Record<string, unknown> | null
}

export interface CoopSet {
  id: string
  chapterId: string | null
  kind: 'split_knowledge' | 'complementary_obstacle'
  reveals: string
}

export interface Ingredient {
  id: string
  chapterId: string | null
  type: 'clue' | 'secret' | 'event' | 'item' | 'rumor'
  content: Record<string, unknown>
  placement: { location_id?: string; npc_id?: string; condition?: string }
  reveals: string
  pillarTags: string[]
  revealsTo: Record<string, string> | null
  coopSetId: string | null
  objectiveLinks: string[]
  humanEdited: boolean
}

export interface EncounterRow {
  id: string
  chapterId: string | null
  type: 'battle' | 'social' | 'environment'
  spec: { summary?: string; enemies?: { name: string; cr: string; count: number }[] }
  budget: { verdict?: string; adjustedXp?: number; xpBudget?: number }
  locationId: string | null
}

export interface GuideWarning {
  id: string
  stage: number
  targetTable: string | null
  targetId: string | null
  message: string
  resolved: boolean
  /** 'info' = a record of something the pipeline already fixed; 'warning' = needs a human. */
  kind: 'info' | 'warning'
}

export interface GuideJob {
  id: string
  stage: number
  chapterId: string | null
  status: 'queued' | 'running' | 'done' | 'failed'
  error: string | null
  attempts: number
}

// Closed-vocabulary signal ref (F04 SS4.2) as stored: objective/NPC row ids or a dial threshold.
export type EndingSignalWhen =
  | { objective_id: string | null; outcome: 'completed' | 'failed' }
  | { npc_id: string | null; state: 'dead' | 'alive' | 'allied' | 'hostile' }
  | { dial: string; gte?: number; lte?: number }

export interface EndingSignal {
  when: EndingSignalWhen
  weight: number
  note: string
}

export interface Ending {
  id: string
  index: number
  title: string
  description: string
  climaxSummary: string
  tone: string
  triggerConditions: { summary: string; signals: EndingSignal[] }
  exclusivityGroup: string
  isEmergent: boolean
  status: 'candidate' | 'leading' | 'committed' | 'discarded'
  humanEdited: boolean
  pendingRegen: Record<string, unknown> | null
}

export interface VoiceProfile {
  id: string
  name: string
  storagePath: string
}

/** Quest contract (F04 SS4.3): the authored offer behind F08's reactive-story gate. */
export interface GuideContract {
  id: string
  chapterId: string | null
  label: string
  giverNpcId: string
  isEntry: boolean
  reward: { gold_floor?: number; gold_ceiling?: number; extras?: string[] }
  stakes: string
  deadline: { days?: number } | null
  objectiveIds: string[]
  humanEdited: boolean
}

export interface GuideData {
  adventure: GuideAdventure
  chapters: Chapter[]
  objectives: Objective[]
  npcs: Npc[]
  locations: LocationRow[]
  coopSets: CoopSet[]
  ingredients: Ingredient[]
  encounters: EncounterRow[]
  endings: Ending[]
  contracts: GuideContract[]
  warnings: GuideWarning[]
  jobs: GuideJob[]
}

export const STAGE_LABELS: Record<number, string> = {
  1: 'Story arc & chapters',
  2: 'Scene scaffolding',
  3: 'Objectives',
  4: 'NPCs, locations & ingredients',
  5: 'Encounters & bosses',
  6: 'Hooks & cross-links',
  7: 'Consistency pass',
  8: 'Candidate endings',
}
