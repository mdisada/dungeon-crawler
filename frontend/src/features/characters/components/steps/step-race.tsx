import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'
import type { SrdRace } from '../../types'

export function StepRace({
  draft,
  updateDraft,
  goNext,
  goBack,
  races,
}: WizardStepProps & { races: SrdRace[] }) {
  const selectedRace = races.find((r) => r.key === draft.raceKey)
  // Size/Speed get their own summary line - filter them out of the trait list so they don't
  // render twice as prose entries.
  const detailTraits = selectedRace?.traits.filter((t) => t.name !== 'Size' && t.name !== 'Speed') ?? []

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Race</h2>
      <Label htmlFor="race-select">Choose a species</Label>
      <Select value={draft.raceKey ?? undefined} onValueChange={(value) => updateDraft({ raceKey: value })}>
        <SelectTrigger id="race-select" className="mt-2 w-full max-w-sm">
          <SelectValue placeholder="Select a race">
            {(value: string | null) => races.find((r) => r.key === value)?.name ?? 'Select a race'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {races.map((race) => (
            <SelectItem key={race.key} value={race.key}>
              {race.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedRace && (
        <div className="mt-6 space-y-3 rounded-md border p-4">
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
            {selectedRace.size && (
              <p>
                <span className="font-medium">Size:</span> {selectedRace.size}
              </p>
            )}
            {selectedRace.speed && (
              <p>
                <span className="font-medium">Speed:</span> {selectedRace.speed}
              </p>
            )}
          </div>
          <dl className="space-y-2">
            {detailTraits.map((trait) => (
              <div key={trait.name}>
                <dt className="text-sm font-medium">{trait.name}</dt>
                <dd className="text-sm whitespace-pre-line text-muted-foreground">{trait.desc}</dd>
              </div>
            ))}
          </dl>
        </div>
      )}

      <StepNav onBack={goBack} onNext={goNext} nextDisabled={!draft.raceKey} showBack={false} />
    </div>
  )
}
