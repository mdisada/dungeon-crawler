import { useState } from 'react'

import { setAutoSettings } from '../../api/session'
import { usePlay } from '../../hooks/use-play-context'

/** Standing automation policy (assist mode only): auto-dialogue (Slice 2) + auto-checks (Slice 4). */
export function AutoToggles() {
  const { adventure, state } = usePlay()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (adventure.mode !== 'assist') return null
  const autoDialogue = state.dm?.settings?.autoDialogue ?? false
  const autoChecks = state.dm?.settings?.autoChecks ?? false

  async function handleToggle(patch: { autoDialogue?: boolean; autoChecks?: boolean }) {
    setBusy(true)
    setError(null)
    try {
      await setAutoSettings(adventure.id, patch)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <section aria-label="AI automation" className="flex flex-col gap-1">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoDialogue}
          disabled={busy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handleToggle({ autoDialogue: e.target.checked })}
        />
        <span>Auto dialogue</span>
        <span className="text-xs text-muted-foreground">
          {autoDialogue ? 'AI sends replies directly' : 'you review every reply'}
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={autoChecks}
          disabled={busy}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => void handleToggle({ autoChecks: e.target.checked })}
        />
        <span>Auto checks</span>
        <span className="text-xs text-muted-foreground">
          {autoChecks ? 'roll outcomes stand' : 'you confirm each outcome'}
        </span>
      </label>
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </section>
  )
}
