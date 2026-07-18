import { useEffect, useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { supabase } from '@/lib/supabase'

import { createCheckpoint, createGenericNpc, demoStep, endSession, restoreCheckpoint } from '../../api/session'
import { fetchGuideNpcs } from '../../api/story'
import type { GuideNpc } from '../../api/story'
import { usePlay } from '../../hooks/use-play-context'
import { DmDiceTab } from './dice-tab'
import { NpcStateControl } from './npc-state-control'

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

/** DM Tools tab: session controls, dice, checkpoints, world facts, generic NPC, session log. */
export function DmToolsTab() {
  const { adventure, state, version } = usePlay()
  const [checkpoints, setCheckpoints] = useState<CheckpointRow[]>([])
  const [events, setEvents] = useState<EventRow[]>([])
  const [npcs, setNpcs] = useState<GuideNpc[]>([])
  const [roleHint, setRoleHint] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => {
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
      void fetchGuideNpcs(adventure.id)
        .then((rows) => !cancelled && setNpcs(rows))
        .catch(() => undefined)
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

  return (
    <div className="flex flex-col gap-4 text-sm">
      {error && <p className="text-destructive">{error}</p>}

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

      <section aria-label="Dice">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Dice</h3>
        <DmDiceTab />
      </section>

      <section aria-label="World facts">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">World facts</h3>
        <p className="mb-1 text-xs text-muted-foreground">
          Mark an NPC dead/absent - the consistency pass blocks drafts that contradict it.
        </p>
        <NpcStateControl adventureId={adventure.id} npcs={npcs} busy={busy !== null} onError={setError} />
      </section>

      <section aria-label="Generic NPC">
        <h3 className="mb-1 text-xs font-semibold uppercase text-muted-foreground">Generic NPC</h3>
        <div className="flex gap-2">
          <Input
            value={roleHint}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRoleHint(e.target.value)}
            placeholder="shopkeeper, guard, barmaid…"
            aria-label="Generic NPC role"
          />
          <Button
            size="sm"
            disabled={state.session.status !== 'active' || busy !== null || !roleHint.trim()}
            onClick={() =>
              void run('generic', async () => {
                await createGenericNpc(adventure.id, roleHint.trim())
                setRoleHint('')
              })
            }
          >
            {busy === 'generic' ? 'Creating…' : 'Create'}
          </Button>
        </div>
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
