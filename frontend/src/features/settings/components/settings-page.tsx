import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { useSession } from '@/features/auth'
import { useUserSettings } from '../hooks/use-user-settings'
import { useWorkerStatus } from '../hooks/use-worker-status'
import { ApiKeysSection } from './api-keys-section'
import { AudioSection } from './audio-section'
import { MediaModelsSection } from './media-models-section'
import { ModelMapSection } from './model-map-section'
import { NarratorTestBox } from './narrator-test-box'
import { ProviderSection } from './provider-section'
import { WorkerTokenSection } from './worker-token-section'

export function SettingsPage() {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  const { state, update } = useUserSettings(userId ?? '')
  const workerStatus = useWorkerStatus(userId)

  if (!userId) return null
  if (state.status === 'loading') return <p className="p-6">Loading settings…</p>
  if (state.status === 'error') return <p className="p-6 text-destructive">Could not load settings: {state.error}</p>

  const { settings } = state

  return (
    <div className="flex w-full max-w-2xl flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
      <Tabs defaultValue="models">
        <TabsList>
          <TabsTab value="models">AI models</TabsTab>
          <TabsTab value="provider">Provider</TabsTab>
          <TabsTab value="keys">API keys</TabsTab>
          <TabsTab value="audio">Audio</TabsTab>
          <TabsTab value="test">Test</TabsTab>
        </TabsList>

        <TabsPanel value="models" className="flex flex-col gap-8">
          <ModelMapSection modelMap={settings.modelMap} onChange={(modelMap) => update({ modelMap })} />
          <MediaModelsSection
            ttsModel={settings.ttsModel}
            imageModel={settings.imageModel}
            embeddingModel={settings.embeddingModel}
            onChangeTtsModel={(ttsModel) => update({ ttsModel })}
            onChangeImageModel={(imageModel) => update({ imageModel })}
          />
        </TabsPanel>

        <TabsPanel value="provider" className="flex flex-col gap-8">
          <ProviderSection settings={settings} onChangeProvider={(provider) => update({ provider })} />
          <WorkerTokenSection workerStatus={workerStatus} />
        </TabsPanel>

        <TabsPanel value="keys">
          <ApiKeysSection
            byokLocalStorage={settings.byokLocalStorage}
            onChange={(byokLocalStorage) => update({ byokLocalStorage })}
          />
        </TabsPanel>

        <TabsPanel value="audio">
          <AudioSection />
        </TabsPanel>

        <TabsPanel value="test">
          <NarratorTestBox />
        </TabsPanel>
      </Tabs>
    </div>
  )
}
