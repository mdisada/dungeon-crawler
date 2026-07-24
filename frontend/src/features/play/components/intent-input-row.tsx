import { Compass } from 'lucide-react'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { useIntents } from '../hooks/use-intents'
import { usePlay } from '../hooks/use-play-context'
import { CheckPrompt } from './check-prompt'

/**
 * The live input surface (F07 SS3.1, all non-battle modes): one free-text line to the DM
 * (the server interprets speech vs action - unified input, 2026-07-20), opening chips
 * (F10 SS3.7), the "DM is thinking" indicator, and the pending-check prompt. There is no
 * unprompted roll here: the DM calls for checks and offers the applicable skills as buttons
 * (2026-07-20 playtest). Rendered by the play page as an overlay so the scene renderers
 * stay presentation-only.
 */
export function IntentInputRow() {
  const { state, isSpectator, reveal } = usePlay()
  const { myCharacterId, isBusy, error, clearError, say, requestHint } = useIntents()
  const [draft, setDraft] = useState('')
  const activeLine = state.dialogue.lines.find((l) => l.id === state.dialogue.activeLineId) ?? null
  const { isRevealing } = reveal

  if (isSpectator || !myCharacterId || state.session.status !== 'active') return null

  const { typing, pending, openings } = state.dialogue
  // pending is nullish (null or, in states seeded before the field existed, undefined) when no
  // check is live - either way the input stays open. While a line is still being delivered the
  // input grays out too, so an ENABLED input always means "the table is waiting on you".
  // isBusy counts as thinking: the request is in flight before the server's typing flag can
  // arrive, and that gap read as "stuck" in playtests. The player paces the reveal themselves
  // now, so "the DM is thinking" only means anything once they have clicked to the end of the
  // line - until then it would be telling them to wait for text they already have.
  const isThinking = (typing || isBusy) && !isRevealing
  const inputBlocked = isThinking || pending != null || isRevealing
  const placeholder = isThinking
    ? 'The DM is thinking…'
    : isRevealing
      ? activeLine?.speaker
        ? `${activeLine.speaker} is speaking…`
        : 'The story unfolds…'
      : inputBlocked
        ? 'Waiting on the table…'
        : 'Tell the DM what you say or do'
  const myOpenings = openings.filter((o) => o.unlockedBy !== myCharacterId)

  async function submit() {
    const text = draft.trim()
    if (!text) return
    const ok = await say(text)
    if (ok) setDraft('')
  }

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center px-4 pb-3">
      <div className="pointer-events-auto flex w-full max-w-4xl flex-col gap-2">
        {myOpenings.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {myOpenings.map((opening) => (
              <span
                key={opening.id}
                className="rounded-full border border-emerald-300/50 bg-emerald-950/80 px-3 py-1 text-xs text-emerald-200"
              >
                Opening: {opening.hint}
              </span>
            ))}
          </div>
        )}

        {pending && <CheckPrompt />}

        {isThinking && (
          <div className="flex justify-center">
            <p
              role="status"
              className="flex items-center gap-2 rounded-full bg-black/75 px-4 py-1.5 text-xs text-white/90 shadow-lg"
            >
              <span aria-hidden className="flex items-center gap-1">
                <span className="size-1.5 animate-bounce rounded-full bg-white/90" />
                <span className="size-1.5 animate-bounce rounded-full bg-white/90 [animation-delay:150ms]" />
                <span className="size-1.5 animate-bounce rounded-full bg-white/90 [animation-delay:300ms]" />
              </span>
              The DM is thinking…
            </p>
          </div>
        )}

        {error && (
          <p className="rounded bg-red-950/80 px-3 py-1 text-center text-xs text-red-200" role="alert">
            {error}
            <button className="ml-2 underline" onClick={clearError}>
              dismiss
            </button>
          </p>
        )}

        <form
          className="flex gap-2"
          onSubmit={(e: React.FormEvent<HTMLFormElement>) => {
            e.preventDefault()
            void submit()
          }}
        >
          <Input
            value={draft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
            placeholder={placeholder}
            disabled={inputBlocked}
            aria-label="Action or dialogue input"
            className="bg-black/60 text-white placeholder:text-white/40"
          />
          <Button type="submit" variant="secondary" disabled={inputBlocked || !draft.trim()}>
            Send
          </Button>
          {/* In-fiction "ask the DM" (2026-07-20): the character takes a moment to get their
              bearings and the DM offers an escalating nudge. Not a menu, not a mechanic. */}
          <Button
            type="button"
            variant="ghost"
            size="icon"
            disabled={inputBlocked}
            aria-label="Take a moment to get your bearings"
            title="Take a moment — ask the DM to get your bearings"
            onClick={() => void requestHint()}
            className="text-white/70 hover:text-white"
          >
            <Compass className="size-4" />
          </Button>
        </form>
      </div>
    </div>
  )
}
