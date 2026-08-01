import { Slider, SliderControl, SliderIndicator, SliderThumb, SliderTrack } from '@/components/ui/slider'
import { FISH_MODELS } from '@/features/tts'
import type { VoiceProfile } from '@/features/tts'
import type { LabSettings, StressMode } from '../types'

interface LabControlsProps {
  settings: LabSettings
  onChange: (settings: LabSettings) => void
  profiles: VoiceProfile[]
  /** Frozen knobs are disabled mid-run: changing them would restart synthesis. */
  isRunning: boolean
}

// Kept short on purpose: a <select> is as wide as its longest option, so a sentence in here forces
// its whole grid column wider than its share and pushes the columns into each other.
const STRESS_LABELS: Record<StressMode, string> = {
  manual: 'Manual',
  reader: 'Reader (auto)',
  impatient: 'Impatient',
}

const STRESS_HINTS: Record<StressMode, string> = {
  manual: 'You click, like a player.',
  reader: 'Advances at the reading speed below.',
  impatient: 'Clicks the instant the chevron appears - finds where the gate opens too early.',
}

const SELECT_CLASS = 'h-9 w-full min-w-0 rounded-md border bg-background px-2 text-sm'

/**
 * A titled group of controls.
 *
 * `fieldset` stays a block and the flex lives on an inner div: with `display:flex` on the fieldset
 * itself, browsers render the `legend` in its own slot outside the flex formatting context and the
 * first control is laid out underneath it. `min-w-0` overrides the fieldset's default
 * `min-inline-size: min-content`, without which a grid column refuses to shrink and spills over
 * its neighbour.
 */
function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="mb-3 text-xs font-semibold uppercase text-muted-foreground">{title}</legend>
      <div className="flex min-w-0 flex-col gap-4">{children}</div>
    </fieldset>
  )
}

function Check({
  label,
  checked,
  disabled,
  onChange,
}: {
  label: string
  checked: boolean
  disabled?: boolean
  onChange: (checked: boolean) => void
}) {
  return (
    <label className="flex items-start gap-2 text-xs">
      <input
        type="checkbox"
        className="mt-0.5 shrink-0"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  )
}

function RangeKnob({
  label,
  display,
  value,
  min,
  max,
  step = 1,
  disabled,
  onValueChange,
}: {
  label: string
  display: string
  value: number
  min: number
  max: number
  step?: number
  disabled?: boolean
  onValueChange: (value: number) => void
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <div className="flex min-w-0 items-baseline justify-between gap-2 text-xs">
        <span className="truncate">{label}</span>
        <span className="shrink-0 font-mono text-muted-foreground">{display}</span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        aria-label={label}
        onValueChange={(next) => onValueChange(Number(next))}
      >
        <SliderControl>
          <SliderTrack>
            <SliderIndicator />
            <SliderThumb />
          </SliderTrack>
        </SliderControl>
      </Slider>
    </div>
  )
}

export function LabControls({ settings, onChange, profiles, isRunning }: LabControlsProps) {
  const set = <K extends keyof LabSettings>(key: K, value: LabSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="grid gap-x-8 gap-y-6 rounded-lg border p-4 sm:grid-cols-2 lg:grid-cols-3">
      <Group title="Timing">
        <RangeKnob
          label="Deadline"
          display={`${(settings.deadlineMs / 1000).toFixed(1)}s`}
          value={settings.deadlineMs}
          min={500}
          max={20_000}
          step={250}
          onValueChange={(value) => set('deadlineMs', value)}
        />
        <RangeKnob
          label="Fan-out"
          display={settings.maxInFlight === 1 ? 'sequential' : `${settings.maxInFlight} at once`}
          value={settings.maxInFlight}
          min={1}
          max={5}
          disabled={isRunning}
          onValueChange={(value) => set('maxInFlight', value)}
        />
        <Check
          label="Hold the first box until its audio is ready"
          checked={settings.holdFirstBox}
          disabled={isRunning}
          onChange={(checked) => set('holdFirstBox', checked)}
        />
      </Group>

      <Group title="Engine & voice">
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Engine
          <select
            className={SELECT_CLASS}
            value={settings.model}
            disabled={isRunning}
            onChange={(e) => set('model', e.target.value)}
          >
            {FISH_MODELS.map((model) => (
              <option key={model} value={model}>
                {model}
                {model === 's2.1-pro-free' ? ' (free)' : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Voice
          <select
            className={SELECT_CLASS}
            value={settings.voiceProfileId ?? ''}
            disabled={isRunning}
            onChange={(e) => set('voiceProfileId', e.target.value || null)}
          >
            {/* Explicitly opting into silence. The lab has no adventure to fall back to, so this
                is the only way to reproduce what an unvoiced adventure does - never a default. */}
            <option value="">No voice (silent)</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <Check
          label="Bypass the cache - measure synthesis, not storage"
          checked={settings.force}
          disabled={isRunning}
          onChange={(checked) => set('force', checked)}
        />
        <RangeKnob
          label="Volume"
          display={`${Math.round(settings.volume * 100)}%`}
          value={settings.volume * 100}
          min={0}
          max={100}
          onValueChange={(value) => set('volume', value / 100)}
        />
      </Group>

      <Group title="Text shape & stress">
        <RangeKnob
          label="Box size"
          display={`${settings.maxChars} chars`}
          value={settings.maxChars}
          min={60}
          max={480}
          step={10}
          disabled={isRunning}
          onValueChange={(value) => set('maxChars', value)}
        />
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Synthesis unit
          <select
            className={SELECT_CLASS}
            value={settings.unit}
            disabled={isRunning}
            onChange={(e) => set('unit', e.target.value as LabSettings['unit'])}
          >
            <option value="box">Per text box (shipped)</option>
            <option value="sentence">Per sentence</option>
          </select>
        </label>
        <label className="flex min-w-0 flex-col gap-1 text-xs">
          Advance mode
          <select
            className={SELECT_CLASS}
            value={settings.stress}
            onChange={(e) => set('stress', e.target.value as StressMode)}
          >
            {(Object.keys(STRESS_LABELS) as StressMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {STRESS_LABELS[mode]}
              </option>
            ))}
          </select>
          <span className="text-muted-foreground">{STRESS_HINTS[settings.stress]}</span>
        </label>
        {settings.stress === 'reader' && (
          <RangeKnob
            label="Reading speed"
            display={`${settings.readingCps} chars/s`}
            value={settings.readingCps}
            min={5}
            max={60}
            onValueChange={(value) => set('readingCps', value)}
          />
        )}
      </Group>
    </div>
  )
}
