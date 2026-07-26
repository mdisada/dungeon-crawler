import { useId } from 'react'

import {
  formatKnobValue, PACING_GROUP_LABELS, PACING_KNOBS, resolvePacing,
} from '@rules/story/pacing'
import type { DifficultyPreset, PacingGroup, PacingKnob, PacingOverrides } from '@rules/story/pacing'

import { Button } from '@/components/ui/button'
import {
  Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack,
} from '@/components/ui/slider'

interface PacingKnobsPanelProps {
  preset: DifficultyPreset
  overrides: PacingOverrides
  onChange: (overrides: PacingOverrides) => void
}

const GROUP_ORDER: PacingGroup[] = ['pressure', 'challenge', 'world']

interface KnobRowProps {
  knob: PacingKnob
  value: number
  presetValue: number
  onChange: (value: number) => void
}

function KnobRow({ knob, value, presetValue, onChange }: KnobRowProps) {
  const labelId = useId()
  const helpId = useId()
  const isChanged = value !== presetValue

  return (
    <div className="flex flex-col gap-1 py-3">
      <div className="flex items-baseline justify-between gap-3">
        <span id={labelId} className="text-sm font-medium">
          {knob.label}
        </span>
        <span className="flex items-baseline gap-2 text-sm tabular-nums">
          <span className={isChanged ? 'font-medium text-primary' : 'text-muted-foreground'}>
            {formatKnobValue(knob, value)}
          </span>
          {isChanged && (
            <button
              type="button"
              onClick={() => onChange(presetValue)}
              className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
            >
              reset
            </button>
          )}
        </span>
      </div>
      <Slider
        value={value}
        onValueChange={(next) => onChange(typeof next === 'number' ? next : next[0])}
        min={knob.min}
        max={knob.max}
        step={1}
      >
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb aria-labelledby={labelId} aria-describedby={helpId} />
          </SliderTrack>
        </SliderControl>
      </Slider>
      <p id={helpId} className="text-sm text-muted-foreground">
        {knob.help}
      </p>
    </div>
  )
}

/**
 * The advanced panel. Values are always shown resolved (preset + overrides) so the numbers on
 * screen are the numbers the adventure will run with - `resolvePacing` may quietly raise a
 * threshold to keep the escalation ladder ordered, and hiding that would make the panel lie.
 */
export function PacingKnobsPanel({ preset, overrides, onChange }: PacingKnobsPanelProps) {
  const resolved = resolvePacing(preset, overrides)
  const presetDefaults = resolvePacing(preset)
  const changedCount = PACING_KNOBS.filter((k) => resolved[k.key] !== presetDefaults[k.key]).length

  function handleKnobChange(knob: PacingKnob, value: number) {
    const next: PacingOverrides = { ...overrides }
    if (value === presetDefaults[knob.key]) delete next[knob.key]
    else next[knob.key] = value
    onChange(next)
  }

  return (
    <div className="flex flex-col gap-6 rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between gap-4">
        <p className="text-sm text-muted-foreground">
          These start from the difficulty above. Change any of them and the rest stay where the
          preset put them.
        </p>
        {changedCount > 0 && (
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange({})}>
            Reset all ({changedCount})
          </Button>
        )}
      </div>

      {GROUP_ORDER.map((group) => (
        <fieldset key={group} className="flex flex-col">
          <legend className="text-sm font-medium">{PACING_GROUP_LABELS[group].title}</legend>
          <p className="mb-1 text-sm text-muted-foreground">{PACING_GROUP_LABELS[group].blurb}</p>
          <div className="divide-y">
            {PACING_KNOBS.filter((knob) => knob.group === group).map((knob) => (
              <KnobRow
                key={knob.key}
                knob={knob}
                value={resolved[knob.key]}
                presetValue={presetDefaults[knob.key]}
                onChange={(value) => handleKnobChange(knob, value)}
              />
            ))}
          </div>
        </fieldset>
      ))}
    </div>
  )
}
