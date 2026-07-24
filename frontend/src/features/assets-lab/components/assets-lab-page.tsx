import { Link } from 'react-router-dom'

import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useSession } from '@/features/auth'
import { useAiCredit, useUserSettings } from '@/features/settings'
import { isAssetsLabUser } from '../debug'
import { useLabRuns } from '../hooks/use-lab-runs'
import { useWorkerCapabilities } from '../hooks/use-worker-capabilities'
import { ImagePanel } from './image-panel'
import { RunTable } from './run-table'
import { TtsPanel } from './tts-panel'

export function AssetsLabPage() {
  const { session } = useSession()
  const email = session?.user.email ?? null
  const userId = session?.user.id ?? null
  const creditUsd = useAiCredit()
  const { state: settingsState } = useUserSettings(userId ?? '')
  const { state: worker, recheck } = useWorkerCapabilities(userId)
  const { runs, record, clear } = useLabRuns()

  if (!isAssetsLabUser(email)) {
    return <p className="p-8 text-muted-foreground">Not available.</p>
  }
  if (!userId) return null

  const imageModelDefault = settingsState.status === 'ready' ? settingsState.settings.imageModel : ''
  const ttsModelDefault = settingsState.status === 'ready' ? settingsState.settings.ttsModel : ''

  return (
    <div className="flex w-full max-w-5xl flex-col gap-6">
      <header className="flex items-center justify-between">
        <div>
          <Link to="/" className="text-xs font-medium text-muted-foreground hover:text-foreground">
            &larr; Home
          </Link>
          <h1 className="text-xl font-semibold">Assets Lab</h1>
          <p className="text-sm text-muted-foreground">
            Compare image and speech generation across OpenRouter and the local worker.
          </p>
        </div>
        <span className="text-sm text-muted-foreground">
          Credit: {creditUsd === null ? '-' : `$${creditUsd.toFixed(2)}`}
        </span>
      </header>

      <Tabs defaultValue="image">
        <TabsList>
          <TabsTab value="image">Image</TabsTab>
          <TabsTab value="tts">Text to speech</TabsTab>
        </TabsList>
        <TabsPanel value="image">
          <ImagePanel
            userId={userId}
            imageModelDefault={imageModelDefault}
            worker={worker}
            onRecheckWorker={recheck}
            onRun={record}
          />
        </TabsPanel>
        <TabsPanel value="tts">
          <TtsPanel
            userId={userId}
            ttsModelDefault={ttsModelDefault}
            worker={worker}
            onRecheckWorker={recheck}
            onRun={record}
          />
        </TabsPanel>
      </Tabs>

      <RunTable runs={runs} onClear={clear} />
    </div>
  )
}
