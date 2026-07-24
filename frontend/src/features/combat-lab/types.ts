import type {
  AttackSpec, Cell, CombatAction, CombatantPatch, CombatantSetup, CombatEvent, CombatSide,
  DifficultySetting, SaveModifiers, SpellSpec,
} from '@rules/combat'

/** One grid cell = 32 px = 5 ft. The map's pixel size is CELL_PX x (cols, rows). */
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

/** The Lab's editable-token stat bundle from a shared engine CombatantSetup (fills save defaults). */
export function labStatsFromSetup(setup: CombatantSetup): LabStats {
  const saves: SaveModifiers = { str: 0, dex: setup.dexMod, con: 0, int: 0, wis: 0, cha: 0, ...setup.saves }
  return {
    hpMax: setup.hpMax, ac: setup.ac, speed: setup.speed, dexMod: setup.dexMod,
    saves, attacks: setup.attacks, spells: setup.spells ?? [],
  }
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
  gridCols: number
  gridRows: number
  setup: { combatants: CombatantSetup[]; obstacles: Cell[]; difficulty: DifficultySetting }
  tape: TapeEntry[]
  events: CombatEvent[]
}
