import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { supabase } from '@/lib/supabase'
import { cn } from '@/lib/utils'

import { admitMember, createCheckpoint, demoStep, endSession, restoreCheckpoint } from '../../api/session'
import { listLobbyMembers } from '../../api/lobby'
import type { LobbyMember } from '../../types'
import { usePlay } from '../../hooks/use-play-context'

interface CheckpointRow {
  id: string
  label: string | null
  kind: 'auto' | 'manual'
  created_at: string
}

interface EventRow {
  id: number
  type: string
  payload: Record<string, unknown>
  created_at: string
}

/** F06 SS5 Overview: objectives checklist, players/NPC status, session log, checkpoints, demo. */
export function DmOverviewTab() {
  const { adventure, state, version } = usePlay()
  const [members, setMembers] = useState<LobbyMember[]>([])
  const [checkpoints, setCheckpoints] = useState<CheckpointRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
      void listLobbyMembers(adventure.id).then((rows) => !cancelled && setMembers(rows))
      void supabase
        .from('checkpoints')
        .select('id, label, kind, created_at')
        .eq('adventure_id', adventure.id)
        .order('created_at', { ascending: false })
        .limit(10)
        .then(({ data }) => !cancelled && setCheckpoints((data ?? []) as CheckpointRow[]))
      void supabase
        .from('event_log')
        .select('id, type, payload, created_at')
        .eq('adventure_id', adventure.id)
        .order('id', { ascending: false })
        .limit(25)
        .then(({ data }) => !cancelled && setEvents((data ?? []) as EventRow[]))
    }
    load()
    const timer = setInterval(load, 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [adventure.id, version])

  async function run(label: string, fn: () => Promise<unknown>) {
    setBusy(label)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Action failed')
    } finally {
      setBusy(null)
    }
  }

  const spectators = members.filter((m) => m.spectator)

  return (
    <div className="flex flex-col gap-4 text-sm">
      {error && <p className="text-destructive">{error}</p>}

      <section aria-label="Objectives">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Objectives</h3>
        <ul className="flex flex-col gap-1">
          {(state.dm?.objectives ?? []).map((o) => (
            <li key={o.id} className="flex items-center gap-2">
              {/* Manual completion override lands with F07's override events (Phase 5). */}
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
                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('admit', () => admitMember(adventure.id, m.id))}>
                  Admit
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-label="Session controls" className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void run('checkpoint', () => createCheckpoint(adventure.id))}>
          {busy === 'checkpoint' ? 'Saving…' : 'Checkpoint'}
        </Button>
        {adventure.isDemo && state.session.status === 'active' && (
          <Button size="sm" disabled={busy !== null} onClick={() => void run('demo', () => demoStep(adventure.id))}>
            {busy === 'demo' ? 'Stepping…' : 'Demo: next step'}
          </Button>
        )}
        {state.session.status === 'active' && (
          <Button size="sm" variant="destructive" disabled={busy !== null} onClick={() => void run('end', () => endSession(adventure.id))}>
            End session
          </Button>
        )}
      </section>

      <section aria-label="Checkpoints">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Checkpoints</h3>
        <ul className="flex flex-col gap-1">
          {checkpoints.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2">
              <span className="truncate text-xs">
                {c.label ?? new Date(c.created_at).toLocaleTimeString()} {c.kind === 'manual' && '· manual'}
              </span>
              {confirmRestore === c.id ? (
                <span className="flex gap-1">
                  <Button size="sm" variant="destructive" disabled={busy !== null}
                    onClick={() => void run('restore', async () => { await restoreCheckpoint(c.id); setConfirmRestore(null) })}>
                    Players will resync — confirm
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(null)}>Cancel</Button>
                </span>
              ) : (
                <Button size="sm" variant="ghost" onClick={() => setConfirmRestore(c.id)}>Restore</Button>
              )}
            </li>
          ))}
          {checkpoints.length === 0 && <li className="text-xs text-muted-foreground">None yet.</li>}
        </ul>
      </section>

      <section aria-label="Session log">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Session log</h3>
        <ul className="flex max-h-48 flex-col gap-0.5 overflow-y-auto text-xs">
          {events.map((e) => (
            <li key={e.id} className="text-muted-foreground">
              <span className="font-mono">{new Date(e.created_at).toLocaleTimeString()}</span> {e.type}
              {typeof e.payload.label === 'string' ? ` — ${e.payload.label}` : ''}
            </li>
          ))}
          {events.length === 0 && <li className="text-muted-foreground">Nothing logged yet.</li>}
        </ul>
      </section>
    </div>
  )
}
