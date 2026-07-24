import { PanelLeftClose, PanelLeftOpen } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useSession } from '@/features/auth'
import {
  activeCombatant, attackAdvantageDetail, blockedCells, cellKey, chebyshev, findPath,
  lineOfSight, predictOpportunityAttacks, reachableCells, spellAffects, spellArea, spellTargets,
} from '@rules/combat'
import type { Cell, CombatantPatch, CombatEngineState } from '@rules/combat'

import { isLabUser } from '../debug'
import { useBattleMaps } from '../hooks/use-battle-maps'
import { useCombatLab } from '../hooks/use-combat-lab'
import { useRoster } from '../hooks/use-roster'
import { hpBandLabel, quantizedHpFraction } from '../redaction'
import { CELL_PX } from '../types'
import { ActionBar } from './action-bar'
import type { CastingState, PendingMove } from './action-bar'
import { CombatPanel } from './combat-panel'
import { ForecastCard } from './forecast-card'
import { InitiativeRail } from './initiative-rail'
import { LabMap } from './lab-map'
import type { LabMapToken } from './lab-map'
import { LogPanel } from './log-panel'
import { MapControls } from './map-controls'
import { RosterPanel } from './roster-panel'
import { SimControls } from './sim-controls'
import { SpellForecastCard } from './spell-forecast-card'
import { TokenEditor } from './token-editor'
import type { EditorTarget } from './token-editor'
import { UnitCard } from './unit-card'
import type { UnitCardView } from './unit-card'

type LabTab = 'setup' | 'combat' | 'log'

export function CombatLabPage() {
  const { user } = useSession()
  if (!user || !isLabUser(user.email)) {
    return <p className="text-sm text-muted-foreground">This page is not available.</p>
  }
  return <CombatLab userId={user.id} />
}

function statusFlags(c: CombatEngineState['combatants'][number]): string[] {
  return [
    ...(c.dodging ? ['dodging'] : []),
    ...(c.disengaged ? ['disengaged'] : []),
    ...(c.auto ? ['auto'] : []),
  ]
}

function CombatLab({ userId }: { userId: string }) {
  const lab = useCombatLab()
  const mapsApi = useBattleMaps(userId)
  const roster = useRoster()
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [targeting, setTargeting] = useState<number | null>(null)
  const [casting, setCasting] = useState<number | null>(null)
  const [spellAim, setSpellAim] = useState<Cell | null>(null)
  const [aimHover, setAimHover] = useState<Cell | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [pendingMove, setPendingMove] = useState<PendingMove | null>(null)
  const [paintMode, setPaintMode] = useState(false)
  const [measureMode, setMeasureMode] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [tab, setTab] = useState<LabTab>('setup')

  const phase: 'setup' | 'combat' = lab.engine ? 'combat' : 'setup'
  const engine = lab.engine
  const active = engine && engine.status === 'active' ? activeCombatant(engine) : null
  const activeIsManual = !!active && !active.auto
  const castingSpell = active && casting !== null ? active.spells[casting] ?? null : null
  const aimMode = !!castingSpell && castingSpell.area.shape !== 'single'
  const aimOrigin = spellAim ?? aimHover

  function clearActionModes() {
    setTargeting(null)
    setCasting(null)
    setSpellAim(null)
    setAimHover(null)
    setPendingMove(null)
  }

  // Follow the phase with the sidebar tab; drop turn-scoped UI state when the turn moves on
  // (state adjusted during render, not in effects).
  const [lastPhase, setLastPhase] = useState(phase)
  if (lastPhase !== phase) {
    setLastPhase(phase)
    setTab(phase)
  }
  const [lastActiveId, setLastActiveId] = useState<string | null>(active?.id ?? null)
  if (lastActiveId !== (active?.id ?? null)) {
    setLastActiveId(active?.id ?? null)
    clearActionModes()
  }

  // Roll20 mode: the lab owns the whole viewport, so the document never shows a scrollbar.
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') clearActionModes()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const targetableIds = useMemo(() => {
    if (!engine || !active) return new Set<string>()
    const obstacleSet = new Set(engine.obstacles.map(([x, y]) => cellKey(x, y)))
    // Single-target spell: side-filtered by what the spell affects, within range, clear sight.
    if (castingSpell && castingSpell.area.shape === 'single') {
      const affects = spellAffects(castingSpell)
      return new Set(
        engine.combatants
          .filter(
            (c) =>
              !c.dead &&
              (affects === 'allies' ? c.side === active.side : affects === 'enemies' ? c.side !== active.side : true) &&
              chebyshev(active, c) <= castingSpell.range &&
              lineOfSight([active.x, active.y], [c.x, c.y], obstacleSet),
          )
          .map((c) => c.id),
      )
    }
    if (targeting === null) return new Set<string>()
    const attack = active.attacks[targeting]
    if (!attack) return new Set<string>()
    return new Set(
      engine.combatants
        .filter(
          (c) =>
            c.side !== active.side &&
            !c.dead &&
            chebyshev(active, c) <= (attack.longRange ?? attack.range) &&
            (attack.kind === 'melee' || lineOfSight([active.x, active.y], [c.x, c.y], obstacleSet)),
        )
        .map((c) => c.id),
    )
  }, [engine, active, targeting, castingSpell])

  const templateCells: Cell[] = useMemo(() => {
    if (!engine || !active || !castingSpell || !aimMode || !aimOrigin) return []
    return spellArea(castingSpell.area, [active.x, active.y], aimOrigin)
  }, [engine, active, castingSpell, aimMode, aimOrigin])

  const aimTargetIds = useMemo(() => {
    if (!engine || !active || !castingSpell || !aimMode || !aimOrigin) return new Set<string>()
    return new Set(spellTargets(engine, active, castingSpell, { cell: aimOrigin }).map((t) => t.id))
  }, [engine, active, castingSpell, aimMode, aimOrigin])

  const { rangeCells, dashCells } = useMemo(() => {
    if (!engine || !active || !activeIsManual || targeting !== null || casting !== null) {
      return { rangeCells: [] as Cell[], dashCells: [] as Cell[] }
    }
    const blocked = blockedCells(engine.obstacles, engine.combatants, active.id)
    const parse = (key: string): Cell => {
      const [x, y] = key.split(',').map(Number)
      return [x, y]
    }
    const reach = reachableCells([active.x, active.y], engine.economy.move, blocked)
    const range = [...reach.keys()].map(parse)
    let dash: Cell[] = []
    if (engine.economy.action) {
      const extended = reachableCells([active.x, active.y], engine.economy.move + active.speed, blocked)
      dash = [...extended.keys()].filter((key) => !reach.has(key)).map(parse)
    }
    return { rangeCells: range, dashCells: dash }
  }, [engine, active, activeIsManual, targeting, casting])

  const mapTokens: LabMapToken[] = engine
    ? engine.combatants.map((c) => ({
        id: c.id,
        name: c.name,
        side: c.side,
        px: c.x * CELL_PX,
        py: c.y * CELL_PX,
        active: active?.id === c.id,
        selected: selectedId === c.id,
        draggable: active?.id === c.id && activeIsManual,
        down: c.dead ? 'dead' : c.conditions.includes('unconscious') ? 'unconscious' : null,
        hpFraction:
          c.side === 'party'
            ? c.hp.current / Math.max(1, c.hp.max)
            : quantizedHpFraction(c.hp.current, c.hp.max),
        conditions: [...c.conditions, ...(c.dodging ? ['dodging'] : []), ...(c.disengaged ? ['disengaged'] : [])],
        targetable: targetableIds.has(c.id) || aimTargetIds.has(c.id),
      }))
    : lab.tokens.map((t) => ({
        id: t.id,
        name: t.name,
        side: t.side,
        px: t.px,
        py: t.py,
        active: false,
        selected: selectedId === t.id,
        draggable: true,
        down: null,
        hpFraction: null,
        conditions: [],
        targetable: false,
      }))

  function nameOf(id: string): string {
    return (
      engine?.combatants.find((c) => c.id === id)?.name ??
      lab.tokens.find((t) => t.id === id)?.name ??
      'Unknown'
    )
  }

  function pageAct(action: Parameters<typeof lab.act>[0]) {
    setPendingMove(null)
    lab.act(action)
  }

  function handleTokenDrop(id: string, px: number, py: number) {
    if (!engine) {
      lab.updateToken(id, { px, py })
      return
    }
    if (!active || id !== active.id || !activeIsManual) return
    const to: Cell = [Math.floor(px / CELL_PX), Math.floor(py / CELL_PX)]
    if (to[0] === active.x && to[1] === active.y) {
      setPendingMove(null)
      return
    }
    const stepCost = active.conditions.includes('prone') ? 2 : 1
    const blocked = blockedCells(engine.obstacles, engine.combatants, active.id)
    const path = findPath([active.x, active.y], to, blocked)
    if (!path || path.length === 0) {
      setPendingMove({ to, path: [], cost: 0, provokes: [], reason: 'No path to that square' })
      return
    }
    const cost = path.length * stepCost
    setPendingMove({
      to,
      path,
      cost,
      provokes: predictOpportunityAttacks(engine, active.id, path),
      reason:
        cost > engine.economy.move
          ? `Not enough movement (needs ${cost} sq, have ${engine.economy.move})`
          : null,
    })
  }

  function handleTokenClick(id: string) {
    if (engine && castingSpell && castingSpell.area.shape === 'single' && casting !== null && targetableIds.has(id)) {
      pageAct({ type: 'cast', spellIndex: casting, targetId: id })
      clearActionModes()
      return
    }
    if (engine && targeting !== null && targetableIds.has(id)) {
      pageAct({ type: 'attack', targetId: id, attackIndex: targeting })
      setTargeting(null)
      return
    }
    setSelectedId(id)
  }

  function pickSpell(index: number | null) {
    setTargeting(null)
    setPendingMove(null)
    setSpellAim(null)
    setAimHover(null)
    setCasting(index)
  }

  function confirmCast() {
    if (!engine || !active || !castingSpell || casting === null || !aimMode || !spellAim) return
    pageAct({ type: 'cast', spellIndex: casting, aim: spellAim })
    clearActionModes()
  }

  const castingInfo: CastingState | null =
    engine && active && castingSpell && casting !== null
      ? {
          spellIndex: casting,
          spellName: castingSpell.name,
          mode: aimMode ? 'aoe' : 'single',
          aimPlaced: aimMode ? spellAim !== null : true,
          aimReason:
            aimMode && spellAim && castingSpell.range > 0 &&
            chebyshev(active, { x: spellAim[0], y: spellAim[1] }) > castingSpell.range
              ? 'Aim point out of range'
              : null,
          affected: engine.combatants.filter((c) => aimTargetIds.has(c.id)).map((c) => c.name),
        }
      : null

  const forecastOverlay = useMemo(() => {
    if (!engine || !active || !hoverId || !targetableIds.has(hoverId)) return null
    const target = engine.combatants.find((c) => c.id === hoverId)
    if (!target) return null
    const anchor = { x: target.x * CELL_PX + CELL_PX + 10, y: target.y * CELL_PX - 8 }
    if (castingSpell && castingSpell.area.shape === 'single') {
      return { ...anchor, content: <SpellForecastCard spell={castingSpell} target={target} /> }
    }
    if (targeting !== null) {
      const attack = active.attacks[targeting]
      if (!attack) return null
      const detail = attackAdvantageDetail(engine, active, target, attack)
      return {
        ...anchor,
        content: <ForecastCard attack={attack} advantage={detail.advantage} reasons={detail.reasons} target={target} />,
      }
    }
    return null
  }, [engine, active, targeting, castingSpell, hoverId, targetableIds])

  const unitCardView: UnitCardView | null = useMemo(() => {
    if (!engine || !selectedId) return null
    const c = engine.combatants.find((x) => x.id === selectedId)
    if (!c) return null
    const redacted = c.side === 'enemy'
    return {
      id: c.id,
      name: c.name,
      side: c.side,
      kind: c.kind,
      redacted,
      hpLabel: redacted
        ? hpBandLabel(c.hp.current, c.hp.max)
        : `${c.hp.current}/${c.hp.max}${c.hp.temp > 0 ? ` (+${c.hp.temp} temp)` : ''}`,
      hpFraction: redacted ? quantizedHpFraction(c.hp.current, c.hp.max) : c.hp.current / Math.max(1, c.hp.max),
      ac: redacted ? null : c.ac,
      speed: c.speed,
      conditions: c.conditions,
      flags: [...statusFlags(c), ...(c.dead ? ['dead'] : [])],
      attacks: redacted ? null : c.attacks,
    }
  }, [engine, selectedId])

  const editorTarget: EditorTarget | null = useMemo(() => {
    if (!selectedId) return null
    if (engine) {
      const c = engine.combatants.find((x) => x.id === selectedId)
      if (!c) return null
      return {
        id: c.id, name: c.name, phase: 'combat', hpCurrent: c.hp.current, hpMax: c.hp.max,
        hpTemp: c.hp.temp, ac: c.ac, speed: c.speed, side: c.side, attacks: c.attacks, spells: c.spells,
      }
    }
    const t = lab.tokens.find((x) => x.id === selectedId)
    if (!t) return null
    return {
      id: t.id, name: t.name, phase: 'setup', hpCurrent: null, hpMax: t.stats.hpMax,
      hpTemp: null, ac: t.stats.ac, speed: t.stats.speed, side: t.side, attacks: t.stats.attacks, spells: t.stats.spells,
    }
  }, [selectedId, engine, lab.tokens])

  function handleEditorPatch(patch: CombatantPatch) {
    if (!selectedId) return
    if (engine) {
      lab.editStats(selectedId, patch)
      return
    }
    const t = lab.tokens.find((x) => x.id === selectedId)
    if (!t) return
    lab.updateToken(selectedId, {
      side: patch.side ?? t.side,
      stats: {
        ...t.stats,
        hpMax: patch.hpMax ?? t.stats.hpMax,
        ac: patch.ac ?? t.stats.ac,
        speed: patch.speed ?? t.stats.speed,
        attacks: patch.attacks ?? t.stats.attacks,
        spells: patch.spells ?? t.stats.spells,
      },
    })
  }

  function handleExport() {
    const payload = lab.buildExport()
    if (!payload) return
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `combat-lab-${payload.seed}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const startBlocker: string | null = !lab.gridOn
    ? 'Turn the grid on to enforce combat rules.'
    : !lab.tokens.some((t) => t.side === 'party')
      ? 'Add at least one party combatant (a character, or a monster via "+ Party").'
      : !lab.tokens.some((t) => t.side === 'enemy')
        ? 'Add at least one enemy (a monster or NPC via "+ Enemy").'
        : null

  return (
    <div className="fixed inset-0 z-40 flex bg-background">
      {leftOpen && (
        <aside className="flex h-full w-[360px] shrink-0 flex-col border-r border-border bg-background">
          <Tabs
            value={tab}
            onValueChange={(value) => setTab(String(value) as LabTab)}
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="flex shrink-0 items-center gap-1 p-2">
              <TabsList className="flex-1">
                <TabsTab value="setup">Setup</TabsTab>
                <TabsTab value="combat">DM</TabsTab>
                <TabsTab value="log">Log</TabsTab>
              </TabsList>
              <Button variant="ghost" size="icon-sm" aria-label="Collapse sidebar" onClick={() => setLeftOpen(false)}>
                <PanelLeftClose />
              </Button>
            </div>
            <TabsPanel value="setup" className="mt-0 min-h-0 flex-1 space-y-3 overflow-y-auto p-2 pt-0">
              <MapControls
                mapsState={{ maps: mapsApi.maps, status: mapsApi.status, error: mapsApi.error }}
                selectedMapId={lab.map?.id ?? null}
                view={{ gridOn: lab.gridOn, paintMode, measureMode }}
                onSelectMap={lab.selectMap}
                onUpload={async (name, file) => {
                  const record = await mapsApi.upload(name, file)
                  lab.selectMap(record)
                }}
                onViewChange={(patch) => {
                  if (patch.gridOn !== undefined) lab.setGridOn(patch.gridOn)
                  if (patch.paintMode !== undefined) setPaintMode(patch.paintMode)
                  if (patch.measureMode !== undefined) setMeasureMode(patch.measureMode)
                }}
                onSaveObstacles={() => {
                  if (lab.map) void mapsApi.saveObstacles(lab.map.id, lab.obstacles)
                }}
                canSaveObstacles={!!lab.map}
              />
              <RosterPanel
                characters={roster.characters}
                npcs={roster.npcs}
                status={roster.status}
                error={roster.error}
                tokens={lab.tokens}
                selectedId={selectedId}
                onAdd={lab.addToken}
                onSelect={setSelectedId}
                onRemove={lab.removeToken}
                onToggleAuto={(id, auto) => lab.updateToken(id, { auto })}
                onAutoPlace={lab.autoPlace}
              />
              {phase === 'setup' && editorTarget && <TokenEditor target={editorTarget} onPatch={handleEditorPatch} />}
              <SimControls
                seed={lab.seed}
                stepMode={lab.stepMode}
                difficulty={lab.difficulty}
                gridOn={lab.gridOn}
                partyCount={lab.tokens.filter((t) => t.side === 'party').length}
                enemyCount={lab.tokens.filter((t) => t.side === 'enemy').length}
                startBlocker={startBlocker}
                error={phase === 'setup' ? lab.error : null}
                onSeedChange={lab.setSeed}
                onStepChange={lab.setStepMode}
                onDifficultyChange={lab.changeDifficulty}
                onStart={lab.startCombat}
              />
            </TabsPanel>
            <TabsPanel value="combat" className="mt-0 min-h-0 flex-1 space-y-3 overflow-y-auto p-2 pt-0">
              {engine ? (
                <CombatPanel
                  engine={engine}
                  difficulty={lab.difficulty}
                  onDifficultyChange={lab.changeDifficulty}
                  onAutoResolve={lab.autoResolveTurn}
                  onRunToEnd={lab.runToEnd}
                  onReset={lab.resetCombat}
                />
              ) : (
                <p className="text-sm text-muted-foreground">No combat running -- set up and roll initiative.</p>
              )}
              {phase === 'combat' && editorTarget && <TokenEditor target={editorTarget} onPatch={handleEditorPatch} />}
            </TabsPanel>
            <TabsPanel value="log" className="mt-0 min-h-0 flex-1 p-2 pt-0">
              <LogPanel
                events={lab.revealed}
                queueCount={lab.queue.length}
                stepMode={lab.stepMode}
                canExport={!!engine || lab.revealed.length > 0}
                nameOf={nameOf}
                onRevealNext={lab.revealNext}
                onRevealAll={lab.revealAll}
                onExport={handleExport}
              />
            </TabsPanel>
          </Tabs>
        </aside>
      )}

      <div className="relative min-w-0 flex-1">
        <LabMap
          mapUrl={lab.map?.url ?? null}
          gridOn={lab.gridOn}
          obstacles={lab.obstacles}
          paintMode={paintMode && phase === 'setup' && lab.gridOn}
          measureMode={measureMode}
          targetingActive={targeting !== null || (castingSpell?.area.shape === 'single')}
          aimMode={aimMode}
          templateCells={templateCells}
          tokens={mapTokens}
          rangeCells={rangeCells}
          dashCells={dashCells}
          pendingPath={
            pendingMove && pendingMove.path.length > 0 && active
              ? { from: [active.x, active.y], path: pendingMove.path }
              : null
          }
          anchoredOverlay={forecastOverlay}
          onTokenDrop={handleTokenDrop}
          onTokenClick={handleTokenClick}
          onTokenHover={setHoverId}
          onPaintCell={lab.toggleObstacle}
          onAimHover={setAimHover}
          onAimClick={setSpellAim}
        />

        {engine && (
          <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2">
            <InitiativeRail engine={engine} selectedId={selectedId} onSelect={setSelectedId} />
          </div>
        )}
        {engine && (
          <div className="absolute bottom-3 left-1/2 z-20 -translate-x-1/2">
            <ActionBar
              engine={engine}
              targetingAttack={targeting}
              pendingMove={pendingMove}
              casting={castingInfo}
              onPickAttack={(i) => {
                setPendingMove(null)
                setCasting(null)
                setSpellAim(null)
                setAimHover(null)
                setTargeting(i)
              }}
              onPickSpell={pickSpell}
              onAct={pageAct}
              onConfirmMove={() => {
                if (pendingMove && !pendingMove.reason) pageAct({ type: 'move', to: pendingMove.to })
              }}
              onCancelMove={() => setPendingMove(null)}
              onConfirmCast={confirmCast}
              onPlayAiTurn={lab.autoResolveTurn}
            />
          </div>
        )}
        {engine && unitCardView && (
          <div className="absolute right-2 top-16 z-20">
            <UnitCard view={unitCardView} onClose={() => setSelectedId(null)} />
          </div>
        )}

        <Link
          to="/"
          className="absolute left-2 top-2 z-20 rounded-md bg-background/80 px-2 py-1 text-xs font-medium shadow hover:bg-background"
        >
          &larr; Exit lab
        </Link>
        {lab.error && (
          <p role="alert" className="absolute bottom-20 left-1/2 z-20 -translate-x-1/2 rounded bg-destructive px-3 py-1 text-sm text-white">
            {lab.error}
          </p>
        )}
        {!leftOpen && (
          <Button
            variant="outline"
            size="icon-sm"
            aria-label="Open controls sidebar"
            className="absolute left-2 top-10 z-20"
            onClick={() => setLeftOpen(true)}
          >
            <PanelLeftOpen />
          </Button>
        )}
      </div>
    </div>
  )
}
