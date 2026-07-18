import { parseChoiceEquipmentText } from '../../lib/parse-core-traits'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'
import type { EquipmentOption, SrdBackground, SrdClass } from '../../types'

function OptionGroup({
  title,
  options,
  name,
  value,
  onChange,
}: {
  title: string
  options: EquipmentOption[]
  name: string
  value: string | null
  onChange: (letter: string) => void
}) {
  return (
    <div>
      <p className="mb-2 text-sm font-medium">{title}</p>
      <div className="space-y-2">
        {options.map((option) => (
          <label key={option.letter} className="flex items-start gap-2 rounded-md border p-3 text-sm">
            <input
              type="radio"
              name={name}
              className="mt-1"
              checked={value === option.letter}
              onChange={() => onChange(option.letter)}
            />
            <span>
              <span className="font-medium">({option.letter})</span> {option.desc}
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}

export function StepEquipment({
  draft,
  updateDraft,
  goNext,
  goBack,
  srdClass,
  background,
}: WizardStepProps & { srdClass: SrdClass | undefined; background: SrdBackground | undefined }) {
  const classOptions = srdClass?.equipmentOptions ?? []
  const backgroundOptions = background?.equipmentDesc ? parseChoiceEquipmentText(background.equipmentDesc) : []

  const classDone = classOptions.length === 0 || !!draft.classEquipmentChoice
  const backgroundDone = backgroundOptions.length === 0 || !!draft.equipmentChoice

  return (
    <div>
      <h2 className="mb-1 text-xl font-semibold">Starting Equipment</h2>
      <p className="mb-6 text-sm text-muted-foreground">
        Your class and your background each provide starting equipment - pick one option from each.
      </p>

      <div className="space-y-6">
        {classOptions.length > 0 && (
          <OptionGroup
            title={`From your class (${srdClass?.name ?? ''})`}
            options={classOptions}
            name="class-equipment"
            value={draft.classEquipmentChoice}
            onChange={(letter) => updateDraft({ classEquipmentChoice: letter })}
          />
        )}
        {backgroundOptions.length > 0 && (
          <OptionGroup
            title={`From your background (${background?.name ?? ''})`}
            options={backgroundOptions}
            name="background-equipment"
            value={draft.equipmentChoice}
            onChange={(letter) => updateDraft({ equipmentChoice: letter })}
          />
        )}
        {classOptions.length === 0 && backgroundOptions.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No structured equipment options are available for this class/background combination.
          </p>
        )}
      </div>

      <StepNav onBack={goBack} onNext={goNext} nextDisabled={!classDone || !backgroundDone} />
    </div>
  )
}
