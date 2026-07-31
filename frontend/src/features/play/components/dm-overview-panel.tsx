import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

import { listLobbyMembers } from '../api/lobby'
import { admitMember } from '../api/session'
import { usePlay } from '../hooks/use-play-context'
import type { LobbyMember } from '../types'
import { PanelSection } from './panel-section'

/**
 * Objectives + players, pinned to the upper-left of the DM's window as a collapsible
 * overlay (was previously in the Main sidebar tab). Each section collapses independently.
 */
export function DmOverviewPanel() {
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

  const objectives = state.dm?.objectives ?? []
  const players = state.players.list
  const spectators = members.filter((m) => m.spectator)
  const { offers, quests } = state.objectives

  return (
    <div className="pointer-events-none absolute left-3 top-3 z-20 w-72 max-w-[calc(100%-1.5rem)]">
      <div className="pointer-events-auto flex max-h-[calc(100vh-8rem)] flex-col gap-2 overflow-y-auto rounded-lg border bg-card/95 p-3 text-sm shadow-lg backdrop-blur">
        {error && <p className="text-destructive">{error}</p>}

        <PanelSection title="Objectives" count={objectives.length}>
          {objectives.length === 0 ? (
            <p className="text-xs text-muted-foreground">No objectives yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {objectives.map((o) => (
                <li key={o.id} className="flex items-center gap-2">
                  <input type="checkbox" checked={o.state === 'completed'} readOnly aria-label={o.title} />
                  <span className={cn(o.hidden && 'italic text-muted-foreground')}>
                    {o.title}
                    {o.hidden && ' (hidden)'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </PanelSection>

        <PanelSection title="Quests" count={offers.length + quests.length}>
          {offers.length === 0 && quests.length === 0 ? (
            <p className="text-xs text-muted-foreground">No offers or quests yet.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {offers.map((offer) => (
                <li key={offer.id} className="text-xs">
                  <span className="font-medium text-amber-600 dark:text-amber-400">Offered:</span>{' '}
                  {offer.label} ({offer.giverName}
                  {offer.gold > 0 ? `, ${offer.gold} gp` : ''})
                </li>
              ))}
              {quests.map((quest) => (
                <li key={quest.id} className="text-xs">
                  <span
                    className={cn(
                      (quest.status === 'completed' || quest.status === 'failed') &&
                        'text-muted-foreground line-through',
                    )}
                  >
                    {quest.label}
                  </span>
                  <span className="text-muted-foreground">
                    {' '}- {quest.giverName}
                    {quest.gold > 0 ? `, ${quest.gold} gp` : ''}
                    {quest.status === 'suspended' ? ' (paused)' : ''}
                    {quest.status === 'failed' ? ' (failed)' : ''}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-xs text-muted-foreground">Party gold: {state.players.gold} gp</p>
        </PanelSection>

        <PanelSection title="Players" count={players.length}>
          <ul className="flex flex-col gap-1">
            {players.map((p) => (
              <li key={p.characterId} className="flex items-center justify-between gap-2">
                <span className="truncate">{p.name}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {p.hp.current}/{p.hp.max} HP{p.conditions.length > 0 ? ` · ${p.conditions.join(', ')}` : ''}
                </span>
              </li>
            ))}
          </ul>
          {spectators.length > 0 && (
            <div className="mt-2">
              <p className="text-xs text-muted-foreground">Waiting to be admitted:</p>
              {spectators.map((m) => (
                <div key={m.id} className="mt-1 flex items-center justify-between gap-2">
                  <span className="truncate">{m.characterName ?? 'New player'}</span>
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => void handleAdmit(m.id)}>
                    Admit
                  </Button>
                </div>
              ))}
            </div>
          )}
        </PanelSection>
      </div>
    </div>
  )
}
