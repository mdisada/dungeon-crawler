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

const STRESS_LABELS: Record<StressMode, string> = {
  manual: 'Manual - you click',
  reader: 'Reader - auto-advance at reading speed',
  impatient: 'Impatient - click the moment the chevron appears',
}

function Knob({ label, value, children }: { label: string; value: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs">
        <span>{label}</span>
        <span className="text-muted-foreground">{value}</span>
      </div>
      {children}
    </div>
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
    <Knob label={label} value={display}>
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
    </Knob>
  )
}

export function LabControls({ settings, onChange, profiles, isRunning }: LabControlsProps) {
  const set = <K extends keyof LabSettings>(key: K, value: LabSettings[K]) =>
    onChange({ ...settings, [key]: value })

  return (
    <div className="grid gap-6 rounded-lg border p-4 sm:grid-cols-3">
      <fieldset className="flex flex-col gap-4">
        <legend className="text-xs font-semibold uppercase text-muted-foreground">Timing</legend>
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
          label="Fan-out after chunk 1"
          display={settings.maxInFlight === 1 ? 'sequential' : `${settings.maxInFlight} in flight`}
          value={settings.maxInFlight}
          min={1}
          max={5}
          disabled={isRunning}
          onValueChange={(value) => set('maxInFlight', value)}
        />
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.holdFirstBox}
            disabled={isRunning}
            onChange={(e) => set('holdFirstBox', e.target.checked)}
          />
          Hold the first box until its audio is ready
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-xs font-semibold uppercase text-muted-foreground">Engine &amp; voice</legend>
        <label className="flex flex-col gap-1 text-xs">
          Engine
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
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
        <label className="flex flex-col gap-1 text-xs">
          Voice
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={settings.voiceProfileId ?? ''}
            disabled={isRunning}
            onChange={(e) => set('voiceProfileId', e.target.value || null)}
          >
            {/* Explicitly opting into silence. The lab has no adventure to fall back to, so this
                is the only way to reproduce what an unvoiced adventure does - never a default. */}
            <option value="">No voice - run silently</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={settings.force}
            disabled={isRunning}
            onChange={(e) => set('force', e.target.checked)}
          />
          Bypass the cache (measure synthesis, not storage)
        </label>
        <RangeKnob
          label="Volume"
          display={`${Math.round(settings.volume * 100)}%`}
          value={settings.volume * 100}
          min={0}
          max={100}
          onValueChange={(value) => set('volume', value / 100)}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-4">
        <legend className="text-xs font-semibold uppercase text-muted-foreground">Text shape &amp; stress</legend>
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
        <label className="flex flex-col gap-1 text-xs">
          Synthesis unit
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={settings.unit}
            disabled={isRunning}
            onChange={(e) => set('unit', e.target.value as LabSettings['unit'])}
          >
            <option value="box">One request per text box (shipped)</option>
            <option value="sentence">One request per sentence (queued playback)</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs">
          Advance mode
          <select
            className="h-9 rounded-md border bg-background px-2 text-sm"
            value={settings.stress}
            onChange={(e) => set('stress', e.target.value as StressMode)}
          >
            {(Object.keys(STRESS_LABELS) as StressMode[]).map((mode) => (
              <option key={mode} value={mode}>
                {STRESS_LABELS[mode]}
              </option>
            ))}
          </select>
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
      </fieldset>
    </div>
  )
}
