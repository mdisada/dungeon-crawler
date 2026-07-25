import { useState } from 'react'
import { Link } from 'react-router-dom'

import { useSession } from '@/features/auth'
import { isAdventureLabUser } from '../debug'
import { useLabEntries } from '../hooks/use-lab-entries'
import { usePlaythrough } from '../hooks/use-playthrough'
import { LabPlaythrough } from './lab-playthrough'
import { LabTabs } from './lab-tabs'
import { NarrationView } from './narration-view'
import { RunForm } from './run-form'
import { RunsList } from './runs-list'

const SIDE_TABS = ['runs', 'generate'] as const
const MAIN_TABS = ['narration', 'logs', 'guide'] as const

export function AdventureLabPage() {
  const { session } = useSession()
  const email = session?.user.email ?? null
  const userId = session?.user.id ?? null
  const [scope, setScope] = useState<'mine' | 'all'>('mine')
  const { entries, error, queueRun, cancel } = useLabEntries(userId, scope)
  const [pickedAdv, setPickedAdv] = useState<string | null>(null)
  const [sideTab, setSideTab] = useState<(typeof SIDE_TABS)[number]>('runs')
  const [mainTab, setMainTab] = useState<(typeof MAIN_TABS)[number]>('logs')

  // Until the user picks one, follow the newest inspectable run - derived, not synced in an effect.
  const selectedAdv = pickedAdv ?? entries.find((e) => e.adventureId)?.adventureId ?? null
  const selected = entries.find((e) => e.adventureId === selectedAdv) ?? null
  const isLive = selected?.status === 'running' || selected?.status === 'active'
  const { playthrough, loading, error: inspectError } = usePlaythrough(selectedAdv, isLive)

  if (!isAdventureLabUser(email)) {
    return <p className="p-8 text-muted-foreground">Not available.</p>
  }

  return (
    <div className="fixed inset-0 z-40 flex bg-background">
      <aside className="flex h-full w-96 shrink-0 flex-col gap-3 overflow-y-auto border-r p-4">
        <Link to="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">
          &larr; Exit lab
        </Link>
        <LabTabs tabs={SIDE_TABS} active={sideTab} onChange={(tab) => setSideTab(tab)} />
        {sideTab === 'generate' ? (
          <RunForm onQueue={async (config) => { await queueRun(config); setSideTab('runs') }} />
        ) : (
          <RunsList
            entries={entries}
            error={error}
            selectedAdv={selectedAdv}
            scope={scope}
            onScopeChange={setScope}
            onPick={setPickedAdv}
            onCancel={(id) => void cancel(id)}
          />
        )}
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2 p-4">
        <LabTabs tabs={MAIN_TABS} active={mainTab} onChange={(tab) => setMainTab(tab)} />
        {inspectError && <p className="rounded-md border border-destructive p-2 text-sm text-destructive">{inspectError}</p>}
        {!selectedAdv && <p className="p-4 text-sm text-muted-foreground">Pick a run to inspect its playthrough.</p>}
        {selectedAdv && !playthrough && loading && <p className="p-4 text-sm text-muted-foreground">Loading…</p>}
        {playthrough && mainTab === 'narration' && <NarrationView lines={playthrough.narration} />}
        {playthrough && mainTab === 'logs' && <LabPlaythrough playthrough={playthrough} />}
        {mainTab === 'guide' && (
          <p className="p-4 text-sm text-muted-foreground">
            The Adventure Guide view (authored content + live overlay) arrives in Phase 3.
          </p>
        )}
      </div>
    </div>
  )
}
