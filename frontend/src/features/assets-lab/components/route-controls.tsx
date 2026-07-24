import { useId } from 'react'

import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { AssetRoute } from '@/features/image'
import type { WorkerCapabilities } from '@/lib/asset-job'

export type WorkerState =
  | { status: 'checking' }
  | { status: 'online'; capabilities: WorkerCapabilities }
  | { status: 'offline'; reason: string }

interface Props {
  route: AssetRoute
  onRouteChange: (route: AssetRoute) => void
  model: string
  onModelChange: (model: string) => void
  /** user_settings value used when the model box is left blank. */
  defaultModel: string
  usePlaceholder: boolean
  onPlaceholderChange: (usePlaceholder: boolean) => void
  worker: WorkerState
  onRecheckWorker: () => void
}

/**
 * The controls both media tabs share. Route is chosen per run rather than by flipping
 * user_settings.provider, so comparing OpenRouter against the local worker never reroutes the
 * rest of the app mid-test.
 */
export function RouteControls({
  route,
  onRouteChange,
  model,
  onModelChange,
  defaultModel,
  usePlaceholder,
  onPlaceholderChange,
  worker,
  onRecheckWorker,
}: Props) {
  const modelId = useId()
  const listId = useId()
  const isLocalAvailable = worker.status === 'online'

  return (
    <div className="flex flex-wrap items-end gap-6 rounded-md border p-3">
      <fieldset className="flex flex-col gap-1">
        <legend className="mb-1 text-xs font-medium text-muted-foreground">Route</legend>
        <div className="flex gap-3">
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="asset-route"
              checked={route === 'openrouter'}
              onChange={() => onRouteChange('openrouter')}
            />
            OpenRouter
          </label>
          <label className="flex items-center gap-1.5 text-sm">
            <input
              type="radio"
              name="asset-route"
              checked={route === 'local'}
              disabled={!isLocalAvailable}
              onChange={() => onRouteChange('local')}
            />
            Local worker
          </label>
        </div>
      </fieldset>

      <div className="flex flex-col gap-1">
        <Label htmlFor={modelId} className="text-xs text-muted-foreground">
          Model {route === 'local' && '(worker decides)'}
        </Label>
        <Input
          id={modelId}
          list={listId}
          value={model}
          disabled={route === 'local'}
          placeholder={defaultModel}
          onChange={(e) => onModelChange(e.target.value)}
          className="w-72 font-mono text-xs"
        />
        <datalist id={listId}>
          <option value={defaultModel} />
        </datalist>
      </div>

      <label className="flex items-center gap-1.5 text-sm">
        <input type="checkbox" checked={usePlaceholder} onChange={(e) => onPlaceholderChange(e.target.checked)} />
        Placeholder (free)
      </label>

      <p className="text-xs text-muted-foreground">
        {worker.status === 'checking' && 'Checking for local worker...'}
        {worker.status === 'online' &&
          `Worker online - ${worker.capabilities.ttsBackend ?? 'no tts'}, ` +
            `${worker.capabilities.cuda ? 'CUDA' : 'CPU'}, ` +
            `${worker.capabilities.cloning ? 'cloning' : 'presets only'}, ` +
            `queue ${worker.capabilities.queueDepth}`}
        {worker.status === 'offline' && (
          <>
            Local worker offline ({worker.reason}){' '}
            <button type="button" onClick={onRecheckWorker} className="underline hover:text-foreground">
              retry
            </button>
          </>
        )}
      </p>
    </div>
  )
}
