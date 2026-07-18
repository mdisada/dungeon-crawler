import { useState } from 'react'

import { Button } from '@/components/ui/button'

import { endSocialEncounter } from '../../api/session'
import { usePlay } from '../../hooks/use-play-context'

/**
 * Main-tab adaptive section during a social encounter: staged speakers + End encounter.
 * The gist review console renders above via ReviewPanel (all scene modes).
 */
export function RoleplaySection() {
  const { adventure, state } = usePlay()
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  async function handleEnd() {
    setBusy(true)
    setNotice(null)
    try {
      await endSocialEncounter(adventure.id)
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-3">
      {notice && (
        <p className="rounded bg-destructive/10 px-2 py-1 text-xs text-destructive" role="alert">
          {notice}
        </p>
      )}

      <section>
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Social encounter</h3>
        <ul className="flex flex-col gap-1">
          {state.dialogue.speakers.map((speaker) => (
            <li key={speaker.npcId} className="text-sm">
              {speaker.name}
              {state.dialogue.lines.at(-1)?.npcId === speaker.npcId && (
                <span className="ml-1 text-xs text-muted-foreground">(last speaker)</span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <Button size="sm" variant="secondary" disabled={busy} onClick={() => void handleEnd()}>
        {busy ? 'Ending…' : 'End encounter'}
      </Button>
    </div>
  )
}
