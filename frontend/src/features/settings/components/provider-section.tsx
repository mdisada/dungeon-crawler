import type { UserSettings } from '../types'

interface Props {
  settings: UserSettings
  onChangeProvider: (provider: UserSettings['provider']) => void
}

export function ProviderSection({ settings, onChangeProvider }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Provider</h2>
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">AI provider</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="provider"
            value="openrouter"
            checked={settings.provider === 'openrouter'}
            onChange={() => onChangeProvider('openrouter')}
          />
          OpenRouter (cloud)
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="provider"
            value="local"
            checked={settings.provider === 'local'}
            onChange={() => onChangeProvider('local')}
          />
          Local server
        </label>
      </fieldset>
      {settings.provider === 'local' && (
        <p className="text-sm text-muted-foreground">
          Local server mode has no worker implementation yet -- AI calls will be rejected until a
          worker connects. Generate a worker token below and see F12 for the worker contract.
        </p>
      )}
    </section>
  )
}
