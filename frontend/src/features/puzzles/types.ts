// Mirrors backend/campaign/puzzles.py's PUZZLE_DEFINITION_JSON_SCHEMA field-for-field.

export type Presentation = 'map' | 'text'

export type ElementKind =
  | 'lever'
  | 'dial'
  | 'plate'
  | 'door'
  | 'inscription'
  | 'item'
  | 'mechanism'
  | 'npc'
  | 'marker'

export type EffectType =
  | 'narrate'
  | 'set-state'
  | 'reveal-element'
  | 'reveal-hint'
  | 'ai-instruction'
  | 'solve'
  | 'fail'

export type Effect = {
  type: EffectType
  text: string | null
  elementId: string | null
  state: string | null
  instruction: string | null
}

export type Gate =
  | { kind: 'element-state'; elementId: string; state: string; skill: null; dc: null }
  | { kind: 'skill-check'; elementId: null; state: null; skill: string; dc: number }
  | null

export type Position = { x: number; y: number }

export type TileTrigger = {
  id: string
  on: 'enter' | 'exit'
  x: number
  y: number
  requires: Gate
  effects: Effect[]
  onFail: Effect[]
  once: boolean
  hidden: boolean
}

export type Interaction = {
  id: string
  label: string
  requires: Gate
  effects: Effect[]
  onFail: Effect[]
}

export type StateTrigger = {
  id: string
  when: { elementId: string; state: string }
  effects: Effect[]
  once: boolean
}

export type PuzzleElement = {
  id: string
  name: string
  kind: ElementKind
  description: string
  position: Position | null
  hidden: boolean
  states: string[]
  initialState: string | null
  interactions: Interaction[]
  revealText: string | null
}

export type Grid = {
  width: number
  height: number
  imageUrl: string | null
  blockedTiles: Position[]
  tileTriggers: TileTrigger[]
}

export type WinCondition = {
  requiredStates: { elementId: string; state: string }[]
  sequence: { elementIds: string[]; resetOnMistake: boolean } | null
  solutionText: string | null
}

export type PuzzleDefinition = {
  title: string
  presentation: Presentation
  archetype: string
  description: string
  dmNotes: string
  grid: Grid | null
  elements: PuzzleElement[]
  stateTriggers: StateTrigger[]
  winCondition: WinCondition
  hints: string[]
  maxAttempts: number | null
  successText: string
  failText: string | null
}

export type PuzzleSource = 'detected' | 'template' | 'custom'

// Wizard-local draft, not yet persisted — becomes a `puzzles` row on save-campaign.
export type DraftPuzzle = {
  localId: string
  definition: PuzzleDefinition
  source: PuzzleSource
  plotPointIndex: number | null
}

export type SavedPuzzle = {
  id: number
  campaignId: number
  plotPointId: number | null
  title: string
  archetype: string
  presentation: Presentation
  definition: PuzzleDefinition
  source: PuzzleSource
  status: 'ready' | 'published' | 'retired'
  createdAt: string
}

export type Archetype = {
  id: string
  label: string
  presentation: Presentation
  seed: string
}

// Realtime response payloads (each carries jobId + optional error, added by the backend)
export type PuzzleCompiledResponse = {
  jobId: string
  error?: string
  definition: PuzzleDefinition
  cost: number
}

export type PuzzlesDetectedResponse = {
  jobId: string
  error?: string
  puzzles: { plotPointIndex: number | null; definition: PuzzleDefinition }[]
  cost: number
}
