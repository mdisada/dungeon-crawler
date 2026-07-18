import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { SKILL_ABILITY } from '@rules/character'

import { useIntents } from '../hooks/use-intents'
import { usePlay } from '../hooks/use-play-context'
import { CheckPrompt } from './check-prompt'

const SKILLS = Object.keys(SKILL_ABILITY)

/**
 * The live input surface (F07 SS3.1, all non-battle modes): Say/Do free text, an explicit
 * fast-path skill roll, opening chips (F10 SS3.7), the "DM is thinking" indicator, and the
 * pending-check prompt. Rendered by the play page as an overlay so the scene renderers stay
 * presentation-only.
 */
export function IntentInputRow() {
  const { state, isSpectator } = usePlay()
  const { myCharacterId, isBusy, error, clearError, say, act, roll } = useIntents()
  const [draft, setDraft] = useState('')
  const [skill, setSkill] = useState(SKILLS[0])

  if (isSpectator || !myCharacterId || state.session.status !== 'active') return null

  const { typing, pending, openings } = state.dialogue
  // pending is nullish (null or, in states seeded before the field existed, undefined) when no
  // check is live - either way the input stays open.
  const inputBlocked = isBusy || typing || pending != null
  const myOpenings = openings.filter((o) => o.unlockedBy !== myCharacterId)

  async function submit(kind: 'say' | 'do') {
    const text = draft.trim()
    if (!text) return
    const ok = kind === 'say' ? await say(text) : await act(text)
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

        {typing && (
          <p className="animate-pulse text-center text-xs text-white/70 drop-shadow" role="status">
            The DM is thinking…
          </p>
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
            void submit('say')
          }}
        >
          <Input
            value={draft}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
            placeholder={inputBlocked ? 'Waiting on the table…' : 'Speak, or describe what you do'}
            disabled={inputBlocked}
            aria-label="Action or dialogue input"
            className="bg-black/60 text-white placeholder:text-white/40"
          />
          <Button type="submit" variant="secondary" disabled={inputBlocked || !draft.trim()}>
            Say
          </Button>
          <Button type="button" variant="secondary" disabled={inputBlocked || !draft.trim()} onClick={() => void submit('do')}>
            Do
          </Button>
          <div className="flex">
            <label htmlFor="roll-skill" className="sr-only">
              Skill to roll
            </label>
            <select
              id="roll-skill"
              value={skill}
              onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSkill(e.target.value)}
              disabled={inputBlocked}
              className="rounded-l-md border border-r-0 border-input bg-black/60 px-2 text-sm text-white"
            >
              {SKILLS.map((s) => (
                <option key={s} value={s} className="text-black">
                  {s}
                </option>
              ))}
            </select>
            <Button
              type="button"
              variant="secondary"
              className="rounded-l-none"
              disabled={inputBlocked}
              onClick={() => void roll(skill)}
            >
              Roll
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
