import { Dices, MessagesSquare, Puzzle, Swords } from 'lucide-react'

import type { EncounterState } from '@rules/state'

const KIND_META = {
  skill_challenge: { icon: Dices, title: 'Skill challenge' },
  puzzle: { icon: Puzzle, title: 'Puzzle' },
  social: { icon: MessagesSquare, title: 'Social encounter' },
  combat: { icon: Swords, title: 'Combat' },
} as const

/** Kind-specific progress line derived from the frame's plain-data progress; null = omit. */
function progressLine(encounter: EncounterState): string | null {
  const p = encounter.progress
  if (typeof p !== 'object' || p === null || Array.isArray(p)) return null
  const bag = p as Record<string, unknown>
  const num = (key: string) => (typeof bag[key] === 'number' ? (bag[key] as number) : null)
  if (encounter.kind === 'skill_challenge') {
    const successes = num('successes')
    const needed = num('neededSuccesses')
    const failures = num('failures')
    const maxFailures = num('maxFailures')
    if (successes === null || needed === null) return null
    const setbacks = failures !== null && maxFailures !== null ? ` · ${failures}/${maxFailures} setbacks` : ''
    return `${successes}/${needed} successes${setbacks}`
  }
  if (encounter.kind === 'puzzle') {
    const done = num('stepsDone')
    const total = num('stepsTotal')
    const attempts = num('attemptsLeft')
    const steps = done !== null && total !== null ? `${done}/${total} steps` : null
    const tries = attempts !== null ? `${attempts} ${attempts === 1 ? 'attempt' : 'attempts'} left` : null
    const parts = [steps, tries].filter(Boolean)
    return parts.length > 0 ? parts.join(' · ') : null
  }
  if (encounter.kind === 'social') {
    const exchanges = num('exchanges')
    if (exchanges === null) return null
    return `${exchanges} ${exchanges === 1 ? 'exchange' : 'exchanges'}`
  }
  return null
}

/** One line of player guidance per kind - unclear challenge rules stalled the first playtest. */
function instructionLine(encounter: EncounterState): string | null {
  const p = encounter.progress
  const bag = (typeof p === 'object' && p !== null && !Array.isArray(p) ? p : {}) as Record<string, unknown>
  if (encounter.kind === 'skill_challenge') {
    const skills = Array.isArray(bag.suggestedSkills)
      ? (bag.suggestedSkills as unknown[]).filter((s): s is string => typeof s === 'string')
      : []
    return (
      'Tell the DM each attempt - every roll counts toward success or setback.' +
      (skills.length > 0 ? ` Promising approaches: ${skills.join(', ')}.` : '') +
      ' Vary your approach; repeating one skill gets harder. Questions are free.'
    )
  }
  if (encounter.kind === 'puzzle') {
    return 'Describe what you examine or try - wrong guesses cost attempts, progress unlocks hints, and questions are free.'
  }
  if (encounter.kind === 'social') {
    return 'Talk it out - steer the conversation toward an outcome before tempers decide it for you.'
  }
  return null
}

/**
 * Encounter-states Slice 1: the visible frame. When a typed encounter is open, everyone sees
 * its kind, label, progress, stakes, and how to engage, pinned top-center - like the check
 * prompt, players always know what the game is waiting on. Play stays free-text; the banner
 * is not a form.
 */
export function EncounterBanner({ encounter }: { encounter: EncounterState | null | undefined }) {
  if (!encounter) return null
  const meta = KIND_META[encounter.kind]
  const Icon = meta.icon
  const progress = progressLine(encounter)
  const instruction = instructionLine(encounter)
  return (
    <div className="absolute left-1/2 top-2 z-20 -translate-x-1/2">
      <div className="max-w-md rounded-lg bg-black/70 px-4 py-1.5 text-center">
        <p className="flex items-center justify-center gap-1.5 text-sm font-semibold text-sky-200">
          <Icon className="size-4 shrink-0" aria-hidden="true" />
          <span>
            {meta.title}: {encounter.label}
          </span>
        </p>
        {progress && <p className="text-xs text-white/80">{progress}</p>}
        {encounter.stakes && <p className="text-xs text-white/60">{encounter.stakes}</p>}
        {instruction && <p className="mt-0.5 text-[11px] italic text-sky-100/80">{instruction}</p>}
      </div>
    </div>
  )
}
