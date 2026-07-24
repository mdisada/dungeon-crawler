import type {
  AttackSpec, Cell, CombatAction, CombatantPatch, CombatantSetup, CombatEvent, CombatSide,
  DifficultySetting, SaveModifiers, SpellSpec,
} from '@rules/combat'

/** One grid cell = 32 px on the 1024x1024 map = 5 ft. */
export const CELL_PX = 32
export const FEET_PER_PX = 5 / CELL_PX

export interface LabStats {
  hpMax: number
  ac: number
  speed: number
  dexMod: number
  saves: SaveModifiers
  attacks: AttackSpec[]
  spells: SpellSpec[]
}

/** Setup-phase token. Position is top-left map pixels so gridless placement stays free-form. */
export interface LabToken {
  id: string
  name: string
  kind: 'pc' | 'npc'
  refId: string | null
  side: CombatSide
  auto: boolean
  px: number
  py: number
  stats: LabStats
}

export interface BattleMapRecord {
  id: string
  name: string
  path: string
  obstacles: Cell[]
  url: string
}

export interface RosterCharacter {
  id: string
  name: string
  level: number
  stats: LabStats
}

export interface RosterNpc {
  id: string
  name: string
  role: string
  adventureTitle: string
  stats: LabStats
}

/** Everything replayable the driver did, in order. Replay = createCombat(setup, rng) + tape. */
export type TapeEntry =
  | { op: 'action'; action: CombatAction }
  | { op: 'edit'; id: string; patch: CombatantPatch }
  | { op: 'difficulty'; setting: DifficultySetting }
  | { op: 'auto_turn' }
  | { op: 'run_to_end' }

export interface LabExport {
  exportedAt: string
  seed: number
  mapId: string | null
  gridOn: boolean
  setup: { combatants: CombatantSetup[]; obstacles: Cell[]; difficulty: DifficultySetting }
  tape: TapeEntry[]
  events: CombatEvent[]
}
