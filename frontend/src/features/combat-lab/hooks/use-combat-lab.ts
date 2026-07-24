// The Lab harness state machine: setup phase (map, obstacles, tokens, params) and combat phase
// (engine state + event log + replay tape). All rules run client-side through @rules/combat;
// nothing here touches the play feature or the session edge function (F09 SS9).

import { useRef, useState } from 'react'

import {
  activeCombatant, CombatError, createCombat, editCombatant, resolveAction, runAutoTurn,
  setDifficulty, STANDARD_DIFFICULTY,
} from '@rules/combat'
import type {
  Cell, CombatAction, CombatantPatch, CombatEngineState, CombatEvent, CombatSide,
  DifficultySetting, EngineResult,
} from '@rules/combat'
import { seededRng } from '@rules/play'
import type { Rng } from '@rules/play'

import { CELL_PX } from '../types'
import type { BattleMapRecord, LabExport, LabStats, LabToken, TapeEntry } from '../types'

const AUTO_ADVANCE_CAP = 200
const RUN_TO_END_CAP = 1000

interface LabSetup {
  combatants: Parameters<typeof createCombat>[0]['combatants']
  obstacles: Cell[]
  difficulty: DifficultySetting
}

export function useCombatLab() {
  const [gridOn, setGridOn] = useState(true)
  const [stepMode, setStepMode] = useState(false)
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 1_000_000_000))
  const [difficulty, setDifficultyValue] = useState<DifficultySetting>(STANDARD_DIFFICULTY)
  const [map, setMap] = useState<BattleMapRecord | null>(null)
  const [obstacles, setObstacles] = useState<Cell[]>([])
  const [tokens, setTokens] = useState<LabToken[]>([])
  const [engine, setEngine] = useState<CombatEngineState | null>(null)
  const [revealed, setRevealed] = useState<CombatEvent[]>([])
  const [queue, setQueue] = useState<CombatEvent[]>([])
  const [error, setError] = useState<string | null>(null)
  const rngRef = useRef<Rng | null>(null)
  const setupRef = useRef<LabSetup | null>(null)
  const tapeRef = useRef<TapeEntry[]>([])

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

  function selectMap(record: BattleMapRecord | null) {
    setMap(record)
    setObstacles(record?.obstacles ?? [])
  }

  function toggleObstacle(cell: Cell) {
    setObstacles((prev) => {
      const without = prev.filter(([x, y]) => x !== cell[0] || y !== cell[1])
      return without.length === prev.length ? [...prev, cell] : without
    })
  }

  function addToken(partial: { name: string; kind: 'pc' | 'npc'; refId: string | null; side: CombatSide; stats: LabStats; auto: boolean }) {
    setTokens((prev) => {
      // Stagger spawns down the side's column so new tokens never stack.
      const column = partial.side === 'party' ? 2 : 29
      const row = 4 + (prev.filter((t) => t.side === partial.side).length % 24)
      return [...prev, { id: crypto.randomUUID(), px: column * CELL_PX, py: row * CELL_PX, ...partial }]
    })
  }

  function updateToken(id: string, patch: Partial<Omit<LabToken, 'id'>>) {
    setTokens((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }

  function removeToken(id: string) {
    setTokens((prev) => prev.filter((t) => t.id !== id))
  }

  function autoPlace() {
    setTokens((prev) => {
      const place = (side: CombatSide, column: number) => {
        const group = prev.filter((t) => t.side === side)
        const startRow = Math.max(2, 16 - group.length)
        return new Map(group.map((t, i) => [t.id, { px: column * CELL_PX, py: (startRow + i * 2) * CELL_PX }]))
      }
      const spots = new Map([...place('party', 2), ...place('enemy', 29)])
      return prev.map((t) => (spots.has(t.id) ? { ...t, ...spots.get(t.id) } : t))
    })
  }

  /** Plays every consecutive auto-flagged turn with the minion heuristic, recording the tape. */
  function advanceAutoTurns(first: EngineResult, rng: Rng): EngineResult {
    let state = first.state
    const events = [...first.events]
    for (let i = 0; i < AUTO_ADVANCE_CAP && state.status === 'active'; i++) {
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
        x: Math.min(31, Math.max(0, Math.floor(t.px / CELL_PX))),
        y: Math.min(31, Math.max(0, Math.floor(t.py / CELL_PX))),
        hpMax: t.stats.hpMax, ac: t.stats.ac, speed: t.stats.speed, dexMod: t.stats.dexMod,
        saves: t.stats.saves, attacks: t.stats.attacks, spells: t.stats.spells, auto: t.auto,
      })),
      obstacles,
      difficulty,
    }
    try {
      const rng = seededRng(seed)
      const first = createCombat(setup, rng)
      rngRef.current = rng
      setupRef.current = setup
      tapeRef.current = []
      setRevealed([])
      setQueue([])
      const { state, events } = advanceAutoTurns(first, rng)
      setEngine(state)
      pushEvents(events, stepMode)
    } catch (e) {
      setError(e instanceof CombatError ? e.message : 'Combat failed to start')
    }
  }

  function act(action: CombatAction) {
    if (!engine || !rngRef.current) return
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
    if (!engine || !rngRef.current || engine.status !== 'active') return
    applyAndAdvance(runAutoTurn(engine, rngRef.current), { op: 'auto_turn' })
  }

  function runToEnd() {
    if (!engine || !rngRef.current) return
    let state = engine
    const events: CombatEvent[] = []
    for (let i = 0; i < RUN_TO_END_CAP && state.status === 'active'; i++) {
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
    rngRef.current = null
    setupRef.current = null
    tapeRef.current = []
  }

  function buildExport(): LabExport | null {
    if (!setupRef.current) return null
    return {
      exportedAt: new Date().toISOString(),
      seed,
      mapId: map?.id ?? null,
      gridOn,
      setup: setupRef.current,
      tape: tapeRef.current,
      events: [...revealed, ...queue],
    }
  }

  return {
    gridOn, setGridOn, stepMode, setStepMode, seed, setSeed, difficulty, changeDifficulty,
    map, selectMap, obstacles, toggleObstacle, tokens, addToken, updateToken, removeToken,
    autoPlace, engine, revealed, queue, revealNext, revealAll, error, startCombat, act,
    editStats, autoResolveTurn, runToEnd, resetCombat, buildExport,
  }
}
