// Shared types for the F04 guide pipeline (docs/F04-adventure-guide-pipeline-editor.md SS2-4).
// Plain data only - these modules run under Vitest, the frontend bundle, and the Deno edge
// runtime, so imports stay relative with explicit .ts extensions and no platform APIs.

import type { NpcStatSeed } from './npc-stats.ts'

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

/** Wizard output the pipeline starts from (subset of the adventures row). */
export interface AdventureSeed {
  plotIdea: string
  mode: 'full_ai' | 'assist'
  type: 'one_shot' | 'multi_chapter'
  chaptersMin: number | null
  chaptersMax: number | null
  minPlayers: number
  maxPlayers: number
  difficultyPreset: 'easy' | 'standard' | 'hard' | 'deadly' | null
}

/** One named entity from the story prose - the cohesion contract of F04 SS2.1. */
export interface EntityRef {
  kind: 'npc' | 'location'
  name: string
  /** One-line role, e.g. "lich antagonist" / "volcano where the ritual completes". */
  note: string
}

export interface MetaLoop {
  premise: string
  antagonist: string
  stakes: string
  arc: string
  /** Stage 1's 2-4 one-line ending premises; stage 8 fleshes them into full endings (F04 SS4.2). */
  endingPremises?: string[]
  /** Stage 1's GLOBAL entity registry: every named NPC/location in the story spine (SS2.1). */
  entities?: EntityRef[]
}

export interface ChapterSketch {
  title: string
  arcSummary: string
}

export interface SceneSketch {
  sketch: string
}

export interface ObjectiveDraft {
  title: string
  hiddenDescription: string
  completionPredicates: Json
}

/**
 * Stage 4+ entities reference each other before UUIDs exist, via local string keys unique
 * within one stage response (e.g. "npc:volgarth"). The pipeline maps keys to row ids on insert.
 */
export interface NpcDraft {
  key: string
  name: string
  role: 'npc' | 'boss'
  /** State when play begins. A murder victim must be 'dead' or the NPC agent will voice them. */
  initialState: 'alive' | 'dead' | 'absent'
  personality: Record<string, Json>
  faction: string
  description: string
  imagePrompt: string
  /** Lightweight combat seed (F04 SS3); the pipeline derives the full stat block on insert. */
  combat: NpcStatSeed
}

export interface LocationDraft {
  key: string
  name: string
  description: string
  imagePrompt: string
}

export type IngredientType = 'clue' | 'secret' | 'event' | 'item' | 'rumor'

export interface AffinityRef {
  class?: string
  skill?: string
  background_tag?: string
  character_id?: string
}

export interface IngredientDraft {
  type: IngredientType
  content: Record<string, Json>
  placement: { locationKey?: string; npcKey?: string; condition?: string }
  reveals: string
  pillarTags: ('combat' | 'social' | 'exploration')[]
  revealsTo: AffinityRef | null
  coopSetKey: string | null
  objectiveIndexes: number[]
}

export interface CoopSetDraft {
  key: string
  kind: 'split_knowledge' | 'complementary_obstacle'
  reveals: string
}

export interface EnemySpec {
  name: string
  cr: string
  count: number
}

export interface EncounterDraft {
  type: 'battle' | 'social' | 'environment'
  objectiveIndex: number
  locationKey: string | null
  spec: { enemies?: EnemySpec[]; summary: string }
}

export interface BossUpdateDraft {
  npcKey: string
  tacticsProfile: Record<string, Json>
  bossPhases: Json[]
}

export interface HookDraft {
  /** null for backstory hook slots (no source entity until real characters are known, F05). */
  fromHandle: string | null
  toObjectiveHandle: string
  hookText: string
  kind: 'npc_objective' | 'location_placement' | 'backstory_slot'
}

/** Quest contract draft (F04 SS4.3): the authored extrinsic motivation behind F08's offers. */
export interface ContractDraft {
  label: string
  giverHandle: string
  isEntry: boolean
  goldFloor: number
  goldCeiling: number
  extras: string[]
  stakes: string
  deadlineDays: number | null
  objectiveHandles: string[]
}

export interface WarningDraft {
  targetHandle: string | null
  message: string
  /** major = contradiction/unreachable/broken; minor = clarity and polish. Minors skip the
   *  review popup (2026-07-22, "user clicks less") and land in the collapsed info list. */
  severity: 'major' | 'minor'
}

/** A 2-4 item set of adventure-specific trajectory axes declared by stage 8 (F04 SS4.2). */
export interface StoryDialDraft {
  key: string
  name: string
  description: string
}

export type NpcSignalState = 'dead' | 'alive' | 'allied' | 'hostile'

/**
 * Closed-vocabulary signal ref (F04 SS4.2), draft form: the LLM authors objectives/NPCs by their
 * 1-based list number; the pipeline maps numbers to row UUIDs on insert. Dials are referenced by
 * key with a -5..5 threshold (exactly one of gte/lte).
 */
export type EndingSignalWhenDraft =
  | { objective: number; outcome: 'completed' | 'failed' }
  | { npc: number; state: NpcSignalState }
  | { dial: string; gte?: number; lte?: number }

/** One weighted trigger signal: a closed-vocabulary ref + signed nonzero weight in [-5, 5]. */
export interface EndingSignal {
  when: EndingSignalWhenDraft
  weight: number
  note: string
}

export interface EndingDraft {
  title: string
  /** The canonical 1-2 sentence resolution premise - direction, not script (F04 SS4.2). */
  description: string
  /** Illustrative sketch only; F08 re-authors the real climax at commitment. */
  climaxSummary: string
  tone: string
  triggerConditions: { summary: string; signals: EndingSignal[] }
  exclusivityGroup: string
}

/** Uniform parse result for every stage parser: typed data or human-readable errors. */
export type ParseResult<T> = { ok: true; data: T } | { ok: false; errors: string[] }
