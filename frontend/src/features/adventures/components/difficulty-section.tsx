import { useState } from 'react'

import { DIFFICULTY_PRESETS, hasPacingOverrides, resolvePacing } from '@rules/story/pacing'
import type { DifficultyPreset } from '@rules/story/pacing'

import type { AdventureDraft } from '../types'
import { PacingKnobsPanel } from './pacing-knobs-panel'

interface DifficultySectionProps {
  draft: AdventureDraft
  updateDraft: (patch: Partial<AdventureDraft>) => void
}

/**
 * What each preset means in play, in the terms a player experiences - not "harder monsters".
 * Every claim here is something the profile in @rules/story/pacing actually does.
 */
const PRESET_COPY: Record<DifficultyPreset, { title: string; blurb: string }> = {
  easy: {
    title: 'Easy',
    blurb:
      'The DM helps early. Checks are easier, mistakes cost less, and a party that gets stuck is always handed a way through.',
  },
  standard: {
    title: 'Standard',
    blurb:
      'The intended experience. The DM steps in after a few stuck turns; the party solves most things themselves.',
  },
  hard: {
    title: 'Hard',
    blurb:
      'The DM waits. Checks are stiffer, there is less room for error, and an objective can be lost for good.',
  },
  deadly: {
    title: 'Deadly',
    blurb:
      'The story does not wait for anyone. Help comes late if it comes, the world pushes back, and a stalled party loses the objective.',
  },
}

const CARD_CLASSES =
  'flex cursor-pointer flex-col gap-2 rounded-xl border bg-card p-5 transition-colors ' +
  'hover:border-ring has-checked:border-primary has-checked:bg-accent has-focus-visible:ring-3 has-focus-visible:ring-ring/50'

/** The three numbers worth seeing without opening the panel. */
function summarize(preset: DifficultyPreset, overrides: AdventureDraft['pacingOverrides']) {
  const p = resolvePacing(preset, overrides)
  const dc = p.dcShift === 0 ? 'standard checks' : `checks ${p.dcShift > 0 ? '+' : ''}${p.dcShift}`
  return `A stuck scene turns over after ${p.replanBeat} turns · ${dc} · an objective has ${p.failForwardOnObjective} turns before the story moves on`
}

// Full-AI only: difficulty is fixed at creation (F03 SS3.1). The preset sets every pacing number;
// the disclosure below lets a DM who cares override any single one.
export function DifficultySection({ draft, updateDraft }: DifficultySectionProps) {
  const [isPanelOpen, setIsPanelOpen] = useState(false)
  const preset = draft.difficultyPreset ?? 'standard'
  const isCustomised = hasPacingOverrides(draft.pacingOverrides)

  // Picking a preset re-derives everything. Keeping stale overrides would mean "Deadly" quietly
  // ran with an Easy timeout, which is exactly the mismatch the preset exists to prevent.
  function handleSelectPreset(next: DifficultyPreset) {
    updateDraft({ difficultyPreset: next, pacingOverrides: {} })
  }

  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-3 text-base font-medium">Difficulty and pacing</legend>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {DIFFICULTY_PRESETS.map((value) => (
          <label key={value} className={CARD_CLASSES}>
            <input
              type="radio"
              name="adventure-difficulty"
              value={value}
              checked={preset === value}
              onChange={() => handleSelectPreset(value)}
              className="sr-only"
            />
            <span className="font-medium">{PRESET_COPY[value].title}</span>
            <span className="text-sm text-muted-foreground">{PRESET_COPY[value].blurb}</span>
          </label>
        ))}
      </div>

      <p className="text-sm text-muted-foreground" aria-live="polite">
        {summarize(preset, draft.pacingOverrides)}
        {isCustomised && <span className="ml-2 text-primary">· customised</span>}
      </p>

      <div className="flex flex-col gap-3">
        <button
          type="button"
          onClick={() => setIsPanelOpen((open) => !open)}
          aria-expanded={isPanelOpen}
          aria-controls="pacing-knobs"
          className="w-fit text-sm underline underline-offset-4 hover:text-foreground"
        >
          {isPanelOpen ? 'Hide advanced pacing' : 'Fine-tune pacing'}
        </button>
        {isPanelOpen && (
          <div id="pacing-knobs">
            <PacingKnobsPanel
              preset={preset}
              overrides={draft.pacingOverrides}
              onChange={(pacingOverrides) => updateDraft({ pacingOverrides })}
            />
          </div>
        )}
      </div>

      <p className="text-sm text-muted-foreground">Fixed once the adventure is created.</p>
    </fieldset>
  )
}
