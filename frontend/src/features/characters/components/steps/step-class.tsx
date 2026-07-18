import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SKILL_DESCRIPTIONS } from '../../content/skill-descriptions'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'
import type { SrdBackground, SrdClass } from '../../types'

const DISPLAY_TRAIT_ROWS = ['Primary Ability', 'Weapon Proficiencies', 'Armor Training', 'Tool Proficiencies']

export function StepClass({
  draft,
  updateDraft,
  goNext,
  goBack,
  classes,
  background,
}: WizardStepProps & { classes: SrdClass[]; background: SrdBackground | undefined }) {
  const selectedClass = classes.find((c) => c.key === draft.classKey)

  // Background-granted skills are fixed; the class picks live alongside them in
  // draft.skillProficiencies and get filtered apart here.
  const grantedByBackground = background?.skillProficiencies ?? []
  const classChoices = (selectedClass?.skillChoices ?? []).filter((s) => !grantedByBackground.includes(s))
  const chosenFromClass = draft.skillProficiencies.filter((s) => !grantedByBackground.includes(s))
  const choiceCount = selectedClass?.skillChoiceCount ?? 0

  const selectClass = (key: string | null) => {
    if (!key || key === draft.classKey) return
    // Class change invalidates class-specific picks; background-granted skills survive.
    updateDraft({
      classKey: key,
      skillProficiencies: draft.skillProficiencies.filter((s) => grantedByBackground.includes(s)),
      classEquipmentChoice: null,
    })
  }

  const toggleSkill = (skill: string) => {
    if (chosenFromClass.includes(skill)) {
      updateDraft({ skillProficiencies: draft.skillProficiencies.filter((s) => s !== skill) })
    } else if (chosenFromClass.length < choiceCount) {
      updateDraft({ skillProficiencies: [...draft.skillProficiencies, skill] })
    }
  }

  const skillsComplete = choiceCount === 0 || chosenFromClass.length === choiceCount

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Class</h2>
      <Label htmlFor="class-select">Choose a class</Label>
      <Select value={draft.classKey ?? undefined} onValueChange={selectClass}>
        <SelectTrigger id="class-select" className="mt-2 w-full max-w-sm">
          <SelectValue placeholder="Select a class">
            {(value: string | null) => classes.find((c) => c.key === value)?.name ?? 'Select a class'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {classes.map((cls) => (
            <SelectItem key={cls.key} value={cls.key}>
              {cls.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selectedClass && (
        <>
          <div className="mt-6 space-y-2 rounded-md border p-4 text-sm">
            <p>
              <span className="font-medium">Hit Die:</span> {selectedClass.hitDice}
            </p>
            <p>
              <span className="font-medium">Saving Throw Proficiencies:</span>{' '}
              {selectedClass.savingThrows.join(', ') || 'unknown'}
            </p>
            {DISPLAY_TRAIT_ROWS.filter((row) => selectedClass.traitsTable[row]).map((row) => (
              <p key={row}>
                <span className="font-medium">{row}:</span> {selectedClass.traitsTable[row]}
              </p>
            ))}
          </div>

          <div className="mt-6">
            <p className="mb-1 text-sm font-medium">
              Skill proficiencies — pick {choiceCount} ({chosenFromClass.length} / {choiceCount} chosen)
            </p>
            {grantedByBackground.length > 0 && (
              <p className="mb-2 text-xs text-muted-foreground">
                Your background already grants {grantedByBackground.join(' and ')}; those are excluded here.
              </p>
            )}
            {classChoices.length === 0 ? (
              <p className="text-sm text-muted-foreground">This class has no skill choices to make.</p>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {classChoices.map((skill) => {
                  const isChosen = chosenFromClass.includes(skill)
                  return (
                    <label
                      key={skill}
                      className={`flex items-start gap-2 rounded-md border p-2.5 text-sm ${
                        isChosen ? 'border-primary bg-primary/5' : ''
                      }`}
                    >
                      <input
                        type="checkbox"
                        className="mt-0.5"
                        checked={isChosen}
                        disabled={!isChosen && chosenFromClass.length >= choiceCount}
                        onChange={() => toggleSkill(skill)}
                      />
                      <span>
                        <span className="font-medium">{skill}</span>
                        {SKILL_DESCRIPTIONS[skill] && (
                          <span className="block text-xs text-muted-foreground">{SKILL_DESCRIPTIONS[skill]}</span>
                        )}
                      </span>
                    </label>
                  )
                })}
              </div>
            )}
          </div>
        </>
      )}

      <StepNav onBack={goBack} onNext={goNext} nextDisabled={!draft.classKey || !skillsComplete} />
    </div>
  )
}
