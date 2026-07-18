import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { admitMember } from '../../api/session'
import { listLobbyMembers } from '../../api/lobby'
import type { LobbyMember } from '../../types'
import { usePlay } from '../../hooks/use-play-context'
import { AutoToggles } from './auto-toggles'
import { DmCombatTab } from './combat-tab'
import { NarrationSection } from './narration-section'
import { ReviewPanel } from './review-panel'
import { RoleplaySection } from './roleplay-section'

/**
 * DM Main tab: objectives + players pinned on top, then a context-adaptive section that
 * follows scene.mode - combat status in battle, the reply console in roleplay (Slice 2),
 * narration controls otherwise.
 */
export function DmMainTab() {
  const { adventure, state, version } = usePlay()
  const [members, setMembers] = useState<LobbyMember[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => void listLobbyMembers(adventure.id).then((rows) => !cancelled && setMembers(rows))
    load()
    const timer = setInterval(load, 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [adventure.id, version])

  async function handleAdmit(memberId: string) {
    setBusy(true)
    setError(null)
    try {
      await admitMember(adventure.id, memberId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Admit failed')
    } finally {
      setBusy(false)
    }
  }

  const spectators = members.filter((m) => m.spectator)
  const inCombat = (state.scene.mode === 'battle' || state.scene.mode === 'puzzle') && state.combat !== null

  return (
    <div className="flex flex-col gap-4 text-sm">
      {error && <p className="text-destructive">{error}</p>}

      <section aria-label="Objectives">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Objectives</h3>
        <ul className="flex flex-col gap-1">
          {(state.dm?.objectives ?? []).map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              <input type="checkbox" checked={o.state === 'completed'} readOnly aria-label={o.title} />
              <span className={cn(o.hidden && 'italic text-muted-foreground')}>
                {o.title}
                {o.hidden && ' (hidden)'}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label="Players">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Players</h3>
        <ul className="flex flex-col gap-1">
          {state.players.list.map((p) => (
            <li key={p.characterId} className="flex items-center justify-between">
              <span>{p.name}</span>
              <span className="text-xs text-muted-foreground">
                {p.hp.current}/{p.hp.max} HP{p.conditions.length > 0 ? ` · ${p.conditions.join(', ')}` : ''}
              </span>
            </li>
          ))}
        </ul>
        {spectators.length > 0 && (
          <div className="mt-2">
            <p className="text-xs text-muted-foreground">Waiting to be admitted:</p>
            {spectators.map((m) => (
              <div key={m.id} className="mt-1 flex items-center justify-between">
                <span>{m.characterName ?? 'New player'}</span>
                <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleAdmit(m.id)}>
                  Admit
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <AutoToggles />

      <hr className="border-border" />

      <ReviewPanel />

      {inCombat ? (
        <DmCombatTab combat={state.combat!} />
      ) : state.scene.mode === 'roleplay' ? (
        <RoleplaySection />
      ) : (
        <NarrationSection />
      )}
    </div>
  )
}
