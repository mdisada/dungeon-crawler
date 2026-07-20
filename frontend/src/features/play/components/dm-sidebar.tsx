import { Bug, LayoutDashboard, Music, Wrench } from 'lucide-react'
import { useState } from 'react'

import { Tabs, TabsList, TabsPanel } from '@/components/ui/tabs'
import { useSession } from '@/features/auth'

import { isDebugUser } from '../debug'
import { DebugTab } from './debug-tab'
import { DmImmersionTab } from './dm-tabs/immersion-tab'
import { DmMainTab } from './dm-tabs/main-tab'
import { DmToolsTab } from './dm-tabs/tools-tab'
import { SidebarIconTab } from './sidebar-icon-tab'

/**
 * DM sidebar: Main (objectives + players + context-adaptive section) / Tools / Immersion.
 * Combat status renders inside Main's adaptive section during battle.
 */
export function DmSidebar() {
  const [tab, setTab] = useState('main')
  const { user } = useSession()
  const showDebug = isDebugUser(user?.email)

  return (
    <div className="flex h-full flex-col">
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b p-3">
          <TabsList>
            <SidebarIconTab value="main" label="Main" icon={LayoutDashboard} />
            <SidebarIconTab value="tools" label="Tools" icon={Wrench} />
            <SidebarIconTab value="immersion" label="Immersion" icon={Music} />
            {showDebug && <SidebarIconTab value="debug" label="Debug" icon={Bug} />}
          </TabsList>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          <TabsPanel value="main" className="mt-0">
            <DmMainTab />
          </TabsPanel>
          <TabsPanel value="tools" className="mt-0">
            <DmToolsTab />
          </TabsPanel>
          <TabsPanel value="immersion" className="mt-0">
            <DmImmersionTab />
          </TabsPanel>
          {showDebug && (
            <TabsPanel value="debug" className="mt-0">
              <DebugTab />
            </TabsPanel>
          )}
        </div>
      </Tabs>
    </div>
  )
}
