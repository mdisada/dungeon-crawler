import { useState } from 'react'

import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'

import { DmImmersionTab } from './dm-tabs/immersion-tab'
import { DmMainTab } from './dm-tabs/main-tab'
import { DmToolsTab } from './dm-tabs/tools-tab'

/**
 * DM sidebar: Main (objectives + players + context-adaptive section) / Tools / Immersion.
 * Combat status renders inside Main's adaptive section during battle.
 */
export function DmSidebar() {
  const [tab, setTab] = useState('main')

  return (
    <div className="h-full overflow-y-auto p-3">
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
        <TabsList>
          <TabsTab value="main">Main</TabsTab>
          <TabsTab value="tools">Tools</TabsTab>
          <TabsTab value="immersion">Immersion</TabsTab>
        </TabsList>
        <TabsPanel value="main" className="mt-3">
          <DmMainTab />
        </TabsPanel>
        <TabsPanel value="tools" className="mt-3">
          <DmToolsTab />
        </TabsPanel>
        <TabsPanel value="immersion" className="mt-3">
          <DmImmersionTab />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
