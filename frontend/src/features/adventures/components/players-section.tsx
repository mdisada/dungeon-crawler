import { MinusIcon, PlusIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { PLAYER_BOUNDS, type AdventureDraft } from '../types'

interface PlayersSectionProps {
  draft: AdventureDraft
  updateDraft: (patch: Partial<AdventureDraft>) => void
}

interface StepperProps {
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
}

function Stepper({ label, value, min, max, onChange }: StepperProps) {
  return (
    <div className="flex items-center gap-3">
      <span className="w-10 text-sm font-medium">{label}</span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={`Decrease ${label.toLowerCase()} players`}
        disabled={value <= min}
        onClick={() => onChange(value - 1)}
      >
        <MinusIcon />
      </Button>
      <span className="w-6 text-center text-sm tabular-nums" aria-live="polite">
        {value}
      </span>
      <Button
        type="button"
        variant="outline"
        size="icon-sm"
        aria-label={`Increase ${label.toLowerCase()} players`}
        disabled={value >= max}
        onClick={() => onChange(value + 1)}
      >
        <PlusIcon />
      </Button>
    </div>
  )
}

// F03 SS3.2: min/max steppers, 1 <= min <= max <= 8, DM not counted. The steppers clamp against
// each other so an invalid range can't be entered at all.
export function PlayersSection({ draft, updateDraft }: PlayersSectionProps) {
  return (
    <section className="flex flex-col gap-3" aria-labelledby="players-heading">
      <h2 id="players-heading" className="text-base font-medium">
        Players
      </h2>
      <div className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Stepper
          label="Min"
          value={draft.minPlayers}
          min={PLAYER_BOUNDS.min}
          max={draft.maxPlayers}
          onChange={(value) => updateDraft({ minPlayers: value })}
        />
        <Stepper
          label="Max"
          value={draft.maxPlayers}
          min={draft.minPlayers}
          max={PLAYER_BOUNDS.max}
          onChange={(value) => updateDraft({ maxPlayers: value })}
        />
      </div>
      <p className="text-sm text-muted-foreground">
        The DM is not counted. The lobby won't start below the minimum and closes at the maximum.
      </p>
    </section>
  )
}
