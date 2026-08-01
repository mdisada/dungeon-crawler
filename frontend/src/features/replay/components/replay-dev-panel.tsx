import { ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select'

import { useReplayControl } from '../hooks/use-replay-control'

interface ReplayDevPanelProps {
  adventureId: string
  adventureStatus: string
}

/**
 * The sandbox's only addition to the play screen: a floating panel that reaches the states live
 * play only arrives at through the story planner - session open, fight on the table. It sits
 * OUTSIDE PlayProvider on purpose, so nothing here can be mistaken for play-screen state.
 */
export function ReplayDevPanel({ adventureId, adventureStatus }: ReplayDevPanelProps) {
  const control = useReplayControl(adventureId)
  const [open, setOpen] = useState(true)
  const [battleKey, setBattleKey] = useState<string | null>(null)
  const [confirmRestart, setConfirmRestart] = useState(false)

  const selected = control.battles.find((b) => b.encounterId === battleKey) ?? null
  const sessionLive = control.status?.sessionStatus === 'active'
  const busy = control.busy !== null

  if (!open) {
    return (
      <Button
        size="sm"
        variant="secondary"
        className="fixed bottom-3 left-3 z-60 shadow-lg"
        onClick={() => setOpen(true)}
      >
        <ChevronUp className="mr-1 size-3" />
        Replay tools
      </Button>
    )
  }

  return (
    <aside
      aria-label="Replay sandbox controls"
      className="fixed bottom-3 left-3 z-60 flex w-80 flex-col gap-3 rounded-lg border bg-card/95 p-3 text-sm shadow-2xl backdrop-blur"
    >
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Replay sandbox
        </h2>
        <div className="flex items-center gap-1">
          <Button variant="ghost" size="icon-sm" aria-label="Refresh status" onClick={control.refresh}>
            <RefreshCw className="size-3" />
          </Button>
          <Button variant="ghost" size="icon-sm" aria-label="Collapse replay tools" onClick={() => setOpen(false)}>
            <ChevronDown className="size-3" />
          </Button>
        </div>
      </div>

      <dl className="grid grid-cols-2 gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
        <dt>Adventure</dt>
        <dd className="text-right text-foreground">{adventureStatus}</dd>
        <dt>Session</dt>
        <dd className="text-right text-foreground">{control.status?.sessionStatus ?? '—'}</dd>
        <dt>Scene</dt>
        <dd className="text-right text-foreground">{control.status?.sceneMode ?? '—'}</dd>
        <dt>Encounter</dt>
        <dd className="truncate text-right text-foreground">{control.status?.encounterLabel ?? 'none'}</dd>
        <dt>Combat</dt>
        <dd className="text-right text-foreground">
          {control.status?.combatActive ? `round ${control.status.round ?? '?'}` : 'none'}
        </dd>
      </dl>

      <section className="flex flex-wrap gap-1.5" aria-label="Adventure state">
        <Button size="xs" variant="outline" disabled={busy} onClick={control.enter}>
          {control.busy === 'enter' ? 'Opening…' : 'Re-open'}
        </Button>
        <Button size="xs" variant="outline" disabled={busy} onClick={control.exit}>
          {control.busy === 'exit' ? 'Closing…' : 'Mark completed'}
        </Button>
        {sessionLive ? (
          <Button size="xs" variant="outline" disabled={busy} onClick={control.endSession}>
            {control.busy === 'end-session' ? 'Ending…' : 'End session'}
          </Button>
        ) : (
          <Button size="xs" disabled={busy} onClick={control.startSession}>
            {control.busy === 'start-session' ? 'Starting…' : 'Start session'}
          </Button>
        )}
      </section>

      <section aria-label="Start a fight" className="flex flex-col gap-1.5">
        <Label htmlFor="replay-battle" className="text-xs text-muted-foreground">
          Authored battles
        </Label>
        <Select value={battleKey ?? undefined} onValueChange={(value) => setBattleKey(value)}>
          <SelectTrigger id="replay-battle" className="w-full">
            <SelectValue placeholder="Pick a fight">
              {(value: string | null) =>
                control.battles.find((b) => b.encounterId === value)?.label ?? 'Pick a fight'
              }
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {control.battles.map((battle) => (
              <SelectItem key={battle.encounterId} value={battle.encounterId}>
                {battle.label}
                {battle.hasMap ? '' : ' (no map)'}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {control.battles.length === 0 && (
          <p className="text-xs text-muted-foreground">This adventure authored no battles.</p>
        )}
        {selected && (
          <p className="text-xs text-muted-foreground">Objective: {selected.objectiveTitle}</p>
        )}
        <Button
          size="xs"
          disabled={busy || !selected || !sessionLive || control.status?.combatActive === true}
          title={
            !sessionLive
              ? 'Start the session first'
              : control.status?.combatActive
                ? 'A fight is already on the table'
                : undefined
          }
          onClick={() => selected && control.startCombat(selected)}
        >
          {control.busy === 'start-combat' ? 'Rolling initiative…' : 'Start fight'}
        </Button>
      </section>

      <section aria-label="Restart from guide" className="border-t pt-2">
        {confirmRestart ? (
          <div className="flex flex-col gap-1.5">
            <p className="text-xs text-muted-foreground">
              Deletes this playthrough — sessions, log, checkpoints, and everything the story
              invented — and restores the guide. Characters and seats are kept.
            </p>
            <div className="flex gap-1.5">
              <Button
                size="xs"
                variant="destructive"
                disabled={busy}
                onClick={() => {
                  setConfirmRestart(false)
                  control.restart()
                }}
              >
                {control.busy === 'restart' ? 'Restoring…' : 'Wipe and restore'}
              </Button>
              <Button size="xs" variant="ghost" onClick={() => setConfirmRestart(false)}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <Button size="xs" variant="outline" disabled={busy} onClick={() => setConfirmRestart(true)}>
            Restart from guide
          </Button>
        )}
      </section>

      {control.error && (
        <p role="alert" className="text-xs text-destructive">
          {control.error}
        </p>
      )}
      {control.notice && !control.error && <p className="text-xs text-muted-foreground">{control.notice}</p>}

      <Link to="/replay" className="text-xs text-primary underline-offset-4 hover:underline">
        &larr; Pick another adventure
      </Link>
    </aside>
  )
}
