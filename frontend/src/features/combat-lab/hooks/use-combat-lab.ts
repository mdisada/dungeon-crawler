// The Lab harness state machine: setup phase (map, obstacles, tokens, params) and combat phase
// (engine state + event log + replay tape). All rules run client-side through @rules/combat;
// nothing here touches the play feature or the session edge function (F09 SS9).

import { useRef, useState } from 'react'

import {
  activeCombatant, CombatError, createCombat, editCombatant, fightIsOver, resolveAction, runAutoTurn,
  setDifficulty, STANDARD_DIFFICULTY,
} from '@rules/combat'
import type {
  BossOutcome, Cell, CombatAction, CombatantPatch, CombatEngineState, CombatEvent, CombatManifest,
  CombatSide, DifficultySetting, EngineResult,
} from '@rules/combat'
import { seededRng } from '@rules/play'
import type { Rng } from '@rules/play'

import {
  clampGrid, DEFAULT_GRID_COLS, DEFAULT_GRID_ROWS,
} from '@/features/map-editor'
import type { BattleMapRecord, MapImageFit, Spawns } from '@/features/map-editor'

import { CELL_PX, labStatsFromSetup } from '../types'
import type { LabExport, LabStats, LabToken, TapeEntry } from '../types'

const AUTO_ADVANCE_CAP = 200
const RUN_TO_END_CAP = 1000

interface LabSetup {
  combatants: Parameters<typeof createCombat>[0]['combatants']
  obstacles: Cell[]
  difficulty: DifficultySetting
  gridWidth: number
  gridHeight: number
}

export function useCombatLab() {
  const [gridOn, setGridOn] = useState(true)
  const [gridCols, setGridColsRaw] = useState(DEFAULT_GRID_COLS)
  const [gridRows, setGridRowsRaw] = useState(DEFAULT_GRID_ROWS)
  const [imageFit, setImageFit] = useState<MapImageFit>('fill')
  const [stepMode, setStepMode] = useState(false)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000))
  const [difficulty, setDifficultyValue] = useState<DifficultySetting>(STANDARD_DIFFICULTY)
  const [map, setMap] = useState<BattleMapRecord | null>(null)
  const [obstacles, setObstacles] = useState<Cell[]>([])
  const [spawns, setSpawns] = useState<Spawns>({ party: [], enemy: [] })
  const [tokens, setTokens] = useState<LabToken[]>([])
  const [engine, setEngine] = useState<CombatEngineState | null>(null)
  const [revealed, setRevealed] = useState<CombatEvent[]>([])
  const [queue, setQueue] = useState<CombatEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  // Story-encounter replay (F09 SS11.1): the manifest loaded from a real encounter and the fate the
  // spare/capture beat sets. bossRefRef mirrors manifest.bossRef for the synchronous auto loops.
  const [replayManifest, setReplayManifest] = useState<CombatManifest | null>(null)
  const [bossOutcome, setBossOutcome] = useState<BossOutcome | undefined>(undefined)
  const rngRef = useRef<Rng | null>(null)
  const setupRef = useRef<LabSetup | null>(null)
  const tapeRef = useRef<TapeEntry[]>([])
  const bossRefRef = useRef<string | null>(null)

  function pushEvents(events: CombatEvent[], asStep: boolean) {
    if (asStep) setQueue((q) => [...q, ...events])
    else setRevealed((r) => [...r, ...events])
  }

  function revealNext() {
    setQueue((q) => {
      if (q.length === 0) return q
      setRevealed((r) => [...r, q[0]])
      return q.slice(1)
    })
  }

  function revealAll() {
    setQueue((q) => {
      if (q.length > 0) setRevealed((r) => [...r, ...q])
      return []
    })
  }

  // Selecting an authored map adopts its grid, fit, obstacles, and spawn cells; "No map" restores
  // the editable blank-field defaults. Grid is owned by the map here (the lab's inputs lock).
  function selectMap(record: BattleMapRecord | null) {
    setMap(record)
    if (record) {
      setObstacles(record.obstacles)
      setSpawns(record.spawns)
      setGridColsRaw(record.gridCols)
      setGridRowsRaw(record.gridRows)
      setImageFit(record.imageFit)
    } else {
      setObstacles([])
      setSpawns({ party: [], enemy: [] })
      setGridColsRaw(DEFAULT_GRID_COLS)
      setGridRowsRaw(DEFAULT_GRID_ROWS)
      setImageFit('fill')
    }
  }

  // Column-stagger fallback when a side has no free spawn cell (or the map defines none).
  function staggerSpot(side: CombatSide, index: number): { px: number; py: number } {
    const column = Math.min(gridCols - 1, Math.max(0, side === 'party' ? 2 : gridCols - 3))
    const row = 4 + (index % Math.max(1, gridRows - 6))
    return { px: column * CELL_PX, py: Math.min(gridRows - 1, row) * CELL_PX }
  }

  function nextFreeSpawn(side: CombatSide, existing: LabToken[]): { px: number; py: number } | null {
    const cells = side === 'party' ? spawns.party : spawns.enemy
    if (cells.length === 0) return null
    const taken = new Set(
      existing.filter((t) => t.side === side).map((t) => `${Math.floor(t.px / CELL_PX)},${Math.floor(t.py / CELL_PX)}`),
    )
    const free = cells.find(([x, y]) => !taken.has(`${x},${y}`))
    return free ? { px: free[0] * CELL_PX, py: free[1] * CELL_PX } : null
  }

  function addToken(partial: { name: string; kind: 'pc' | 'npc'; refId: string | null; side: CombatSide; stats: LabStats; auto: boolean }) {
    setTokens((prev) => {
      const count = prev.filter((t) => t.side === partial.side).length
      const spot = nextFreeSpawn(partial.side, prev) ?? staggerSpot(partial.side, count)
      return [...prev, { id: crypto.randomUUID(), px: spot.px, py: spot.py, ...partial }]
    })
  }

  function updateToken(id: string, patch: Partial<Omit<LabToken, 'id'>>) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function removeToken(id: string) {
    setTokens((prev) => prev.filter((t) => t.id !== id))
  }

  // Resizing the grid pulls any token that would now sit off-map back inside the new bounds.
  function setGridCols(n: number) {
    const cols = clampGrid(n)
    setGridColsRaw(cols)
    setTokens((prev) => prev.map((t) => ({ ...t, px: Math.min((cols - 1) * CELL_PX, t.px) })))
  }

  function setGridRows(n: number) {
    const rows = clampGrid(n)
    setGridRowsRaw(rows)
    setTokens((prev) => prev.map((t) => ({ ...t, py: Math.min((rows - 1) * CELL_PX, t.py) })))
  }

  // Snap each side onto its spawn cells in order; any token past the available cells (or when the
  // map defines no spawns) falls to the column stagger.
  function autoPlace() {
    setTokens((prev) => {
      const place = (side: CombatSide) => {
        const cells = side === 'party' ? spawns.party : spawns.enemy
        const group = prev.filter((t) => t.side === side)
        return new Map(
          group.map((t, i) => {
            const spot = i < cells.length
              ? { px: cells[i][0] * CELL_PX, py: cells[i][1] * CELL_PX }
              : staggerSpot(side, i - cells.length)
            return [t.id, spot]
          }),
        )
      }
      const spots = new Map([...place('party'), ...place('enemy')])
      return prev.map((t) => (spots.has(t.id) ? { ...t, ...spots.get(t.id) } : t))
    })
  }

  /** Plays every consecutive auto-flagged turn with the minion heuristic, recording the tape. */
  function advanceAutoTurns(first: EngineResult, rng: Rng): EngineResult {
    let state = first.state
    const events = [...first.events]
    // Stop at a manual turn OR when the fight is over - including boss-down-ends (F09 SS3.6), which
    // the engine can't see, so the driver checks the manifest's bossRef here.
    for (let i = 0; i < AUTO_ADVANCE_CAP && !fightIsOver(state, bossRefRef.current); i++) {
      if (!activeCombatant(state).auto) break
      const result = runAutoTurn(state, rng)
      tapeRef.current.push({ op: 'auto_turn' })
      state = result.state
      events.push(...result.events)
    }
    return { state, events }
  }

  /** Applies an engine step, then lets the heuristic take over until a manual turn comes up. */
  function applyAndAdvance(first: EngineResult, entry: TapeEntry) {
    const rng = rngRef.current
    if (!rng) return
    tapeRef.current.push(entry)
    const { state, events } = advanceAutoTurns(first, rng)
    setEngine(state)
    pushEvents(events, stepMode)
  }

  function startCombat() {
    setError(null)
    const setup: LabSetup = {
      combatants: tokens.map((t) => ({
        id: t.id, name: t.name, side: t.side, kind: t.kind, refId: t.refId, imageUrl: null,
        x: Math.min(gridCols - 1, Math.max(0, Math.floor(t.px / CELL_PX))),
        y: Math.min(gridRows - 1, Math.max(0, Math.floor(t.py / CELL_PX))),
        hpMax: t.stats.hpMax, ac: t.stats.ac, speed: t.stats.speed, dexMod: t.stats.dexMod,
        saves: t.stats.saves, attacks: t.stats.attacks, spells: t.stats.spells, auto: t.auto,
      })),
      obstacles,
      difficulty,
      gridWidth: gridCols,
      gridHeight: gridRows,
    }
    try {
      const rng = seededRng(seed)
      const first = createCombat(setup, rng)
      rngRef.current = rng
      setupRef.current = setup
      tapeRef.current = []
      setRevealed([])
      setQueue([])
      setBossOutcome(undefined)
      const { state, events } = advanceAutoTurns(first, rng)
      setEngine(state)
      pushEvents(events, stepMode)
    } catch (e) {
      setError(e instanceof CombatError ? e.message : 'Combat failed to start')
    }
  }

  function act(action: CombatAction) {
    if (!engine || !rngRef.current || fightIsOver(engine, bossRefRef.current)) return
    setError(null)
    try {
      applyAndAdvance(resolveAction(engine, action, rngRef.current), { op: 'action', action })
    } catch (e) {
      setError(e instanceof CombatError ? e.message : 'Action failed')
    }
  }

  function editStats(id: string, patch: CombatantPatch) {
    if (!engine) return
    setError(null)
    try {
      applyAndAdvance(editCombatant(engine, id, patch), { op: 'edit', id, patch })
    } catch (e) {
      setError(e instanceof CombatError ? e.message : 'Edit failed')
    }
  }

  function changeDifficulty(setting: DifficultySetting) {
    setDifficultyValue(setting)
    if (!engine) return
    applyAndAdvance(setDifficulty(engine, setting), { op: 'difficulty', setting })
  }

  function autoResolveTurn() {
    if (!engine || !rngRef.current || fightIsOver(engine, bossRefRef.current)) return
    applyAndAdvance(runAutoTurn(engine, rngRef.current), { op: 'auto_turn' })
  }

  function runToEnd() {
    if (!engine || !rngRef.current) return
    let state = engine
    const events: CombatEvent[] = []
    for (let i = 0; i < RUN_TO_END_CAP && !fightIsOver(state, bossRefRef.current); i++) {
      const result = runAutoTurn(state, rngRef.current)
      state = result.state
      events.push(...result.events)
    }
    tapeRef.current.push({ op: 'run_to_end' })
    setEngine(state)
    pushEvents(events, stepMode)
  }

  function resetCombat() {
    setEngine(null)
    setRevealed([])
    setQueue([])
    setError(null)
    setBossOutcome(undefined)
    rngRef.current = null
    setupRef.current = null
    tapeRef.current = []
    // Keep the loaded manifest + bossRef so "Back to setup" can re-roll the same replay.
  }

  /**
   * Load a real encounter's CombatManifest as the setup (F09 SS11.1): tear down any running fight,
   * adopt the manifest's map/obstacles/grid/difficulty, and deploy its already-placed party +
   * enemies as tokens (ids preserved so bossRef matches). Then it drives like any Lab fight.
   */
  function loadManifest(manifest: CombatManifest, mapRecord: BattleMapRecord | null) {
    setEngine(null)
    setRevealed([])
    setQueue([])
    setError(null)
    setBossOutcome(undefined)
    rngRef.current = null
    setupRef.current = null
    tapeRef.current = []

    setMap(mapRecord)
    setObstacles(manifest.obstacles)
    setSpawns(mapRecord?.spawns ?? { party: [], enemy: [] })
    setGridColsRaw(manifest.gridWidth)
    setGridRowsRaw(manifest.gridHeight)
    setImageFit(mapRecord?.imageFit ?? 'fill')
    setDifficultyValue(manifest.difficulty)

    setTokens([...manifest.party, ...manifest.enemies].map((s) => ({
      id: s.id,
      name: s.name,
      kind: s.kind,
      refId: s.refId,
      side: s.side,
      auto: s.auto ?? (s.side === 'enemy'),
      px: s.x * CELL_PX,
      py: s.y * CELL_PX,
      stats: labStatsFromSetup(s),
    })))
    setReplayManifest(manifest)
    bossRefRef.current = manifest.bossRef
  }

  /** Drop the loaded replay and clear the board back to a blank hand-built setup. */
  function clearReplay() {
    resetCombat()
    setReplayManifest(null)
    bossRefRef.current = null
    setTokens([])
  }

  function buildExport(): LabExport | null {
    if (!setupRef.current) return null
    return {
      exportedAt: new Date().toISOString(),
      seed,
      mapId: map?.id ?? null,
      gridOn,
      gridCols,
      gridRows,
      setup: setupRef.current,
      tape: tapeRef.current,
      events: [...revealed, ...queue],
    }
  }

  return {
    gridOn, setGridOn, gridCols, setGridCols, gridRows, setGridRows, imageFit, setImageFit,
    stepMode, setStepMode, seed, setSeed, difficulty, changeDifficulty,
    map, selectMap, obstacles, tokens, addToken, updateToken, removeToken,
    autoPlace, engine, revealed, queue, revealNext, revealAll, error, startCombat, act,
    editStats, autoResolveTurn, runToEnd, resetCombat, buildExport,
    replayManifest, bossOutcome, setBossOutcome, loadManifest, clearReplay,
  }
}
