import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'

import { resolveExpiredPrompt } from '../api/session'
import { useIntents } from '../hooks/use-intents'
import { usePlay } from '../hooks/use-play-context'

function secondsLeft(deadline: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(deadline) - now) / 1000))
}

/**
 * The one live check prompt (F07 SS3.4): solo roll, group progress, or an open assist slot.
 * A 1s ticker drives the countdown; when the window lapses any client sweeps the prompt via
 * resolve_pending (edge functions have no timers - the server validates the deadline).
 */
export function CheckPrompt() {
  const { adventure, state } = usePlay()
  const { myCharacterId, isBusy, rollPending, claimAssist } = useIntents()
  const pending = state.dialogue.pending

  const [now, setNow] = useState(() => Date.now())
  const sweptRef = useRef<string | null>(null)

  useEffect(() => {
    if (!pending) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [pending])

  useEffect(() => {
    if (!pending || sweptRef.current === pending.id) return
    if (secondsLeft(pending.deadline, now) > 0) return
    sweptRef.current = pending.id
    // Fire-and-forget: the fastest client wins, everyone else gets a harmless 409.
    resolveExpiredPrompt(adventure.id, pending.id).catch(() => undefined)
  }, [pending, now, adventure.id])

  if (!pending || !myCharacterId) return null
  const remaining = secondsLeft(pending.deadline, now)
  const nameOf = (characterId: string) =>
    state.players.list.find((p) => p.characterId === characterId)?.name ?? 'Someone'

  let body: React.ReactNode
  if (pending.kind === 'check') {
    const mine = pending.actorCharacterId === myCharacterId
    // The DM calls the check and offers the applicable skills as buttons - the player picks
    // which to roll (one option keeps the plain Roll button).
    const options = pending.skillOptions?.length ? pending.skillOptions : [pending.skill]
    body = mine ? (
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm text-white">
          {options.length > 1 ? (
            <>The DM calls for a check — {pending.reason}</>
          ) : (
            <>
              <span className="font-semibold capitalize">{pending.skill}</span> check — {pending.reason}
            </>
          )}
        </p>
        {options.length > 1 ? (
          options.map((skill) => (
            <Button
              key={skill}
              size="sm"
              disabled={isBusy}
              className="capitalize"
              onClick={() => void rollPending(pending.id, skill)}
            >
              Roll {skill}
            </Button>
          ))
        ) : (
          <Button size="sm" disabled={isBusy} onClick={() => void rollPending(pending.id)}>
            Roll
          </Button>
        )}
      </div>
    ) : (
      <p className="text-sm text-white/80">
        Waiting for {nameOf(pending.actorCharacterId ?? '')} to roll {options.join(' / ')}…
      </p>
    )
  } else if (pending.kind === 'group') {
    const rolled = pending.rolled ?? []
    const iRolled = rolled.some((r) => r.characterId === myCharacterId)
    const amIn = (pending.memberCharacterIds ?? []).includes(myCharacterId)
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm text-white">
          Group <span className="font-semibold capitalize">{pending.skill}</span> — {pending.reason}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {(pending.memberCharacterIds ?? []).map((characterId) => {
            const result = rolled.find((r) => r.characterId === characterId)
            return (
              <span
                key={characterId}
                className={
                  result
                    ? 'rounded bg-white/20 px-2 py-0.5 text-xs text-white'
                    : 'rounded border border-dashed border-white/40 px-2 py-0.5 text-xs text-white/60'
                }
              >
                {nameOf(characterId)}
                {result ? `: ${result.total}` : '…'}
              </span>
            )
          })}
          {amIn && !iRolled && (
            <Button size="sm" disabled={isBusy} onClick={() => void rollPending(pending.id)}>
              Roll
            </Button>
          )}
        </div>
      </div>
    )
  } else {
    const amPrimary = pending.primaryCharacterId === myCharacterId
    body = amPrimary ? (
      <p className="text-sm text-white/80">
        You need help: someone with <span className="capitalize">{pending.skill}</span> can step in… ({pending.reason})
      </p>
    ) : (
      <div className="flex items-center gap-3">
        <p className="text-sm text-white">
          {nameOf(pending.primaryCharacterId ?? '')} needs <span className="font-semibold capitalize">{pending.skill}</span>{' '}
          — {pending.effect === 'enable' ? 'their attempt hinges on it' : 'success grants them advantage'}
        </p>
        <Button size="sm" disabled={isBusy} onClick={() => void claimAssist(pending.id)}>
          Help
        </Button>
      </div>
    )
  }

  return (
    <div
      role="status"
      className="pointer-events-auto rounded-lg border border-amber-300/40 bg-black/85 p-3 shadow-lg backdrop-blur"
    >
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-300">Check</span>
        <span className="text-[11px] tabular-nums text-white/60" aria-label="Seconds remaining">
          {remaining}s
        </span>
      </div>
      {body}
    </div>
  )
}
