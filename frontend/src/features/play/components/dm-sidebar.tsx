import { useState } from 'react'

import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'

import { DmCombatTab } from './dm-tabs/combat-tab'
import { DmDiceTab } from './dm-tabs/dice-tab'
import { DmImmersionTab } from './dm-tabs/immersion-tab'
import { DmOverviewTab } from './dm-tabs/overview-tab'
import { usePlay } from '../hooks/use-play-context'

/**
 * F06 SS5: DM sidebar. Overview / Combat (battle only) / Dice / Immersion tabs, with the
 * proposal tray docked below all tabs (empty scaffold until F07 delivers proposals in Phase 5).
 */
export function DmSidebar() {
  const { state } = usePlay()
  const inBattle = state.scene.mode === 'battle' && state.combat !== null
  const [tab, setTab] = useState('overview')
  const effectiveTab = tab === 'combat' && !inBattle ? 'overview' : tab

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <Tabs value={effectiveTab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTab value="overview">Overview</TabsTab>
            {inBattle && <TabsTab value="combat">Combat</TabsTab>}
            <TabsTab value="dice">Dice</TabsTab>
            <TabsTab value="immersion">Immersion</TabsTab>
          </TabsList>
          <TabsPanel value="overview" className="mt-3">
            <DmOverviewTab />
          </TabsPanel>
          {inBattle && (
            <TabsPanel value="combat" className="mt-3">
              <DmCombatTab combat={state.combat!} />
            </TabsPanel>
          )}
          <TabsPanel value="dice" className="mt-3">
            <DmDiceTab />
          </TabsPanel>
          <TabsPanel value="immersion" className="mt-3">
            <DmImmersionTab />
          </TabsPanel>
        </Tabs>
      </div>

      <footer className="border-t p-3">
        <h3 className="text-xs font-semibold uppercase text-muted-foreground">Proposals</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {state.dm?.proposals.length
            ? `${state.dm.proposals.length} pending`
            : 'AI proposals arrive with the live orchestrator (Phase 5).'}
        </p>
      </footer>
    </div>
  )
}
