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
    <div className="flex h-full flex-col">
      <Tabs value={tab} onValueChange={(value) => setTab(String(value))} className="flex min-h-0 flex-1 flex-col">
        <div className="border-b p-3">
          <TabsList>
            <TabsTab value="main">Main</TabsTab>
            <TabsTab value="tools">Tools</TabsTab>
            <TabsTab value="immersion">Immersion</TabsTab>
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
        </div>
      </Tabs>
    </div>
  )
}
