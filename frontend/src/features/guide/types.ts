// Row shapes for the F04 guide editor, camelCased from the guide content tables.

import type { NpcStatBlock } from '@rules/guide'

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

export interface BattleMap {
  imagePath: string | null
  obstacles: [number, number][]
  spawns: [number, number][]
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
