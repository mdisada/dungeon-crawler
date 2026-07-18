import { Progress, ProgressIndicator, ProgressTrack } from '@/components/ui/progress'
import { WIZARD_STEPS, type WizardStep } from '../types'

const STEP_LABELS: Record<WizardStep, string> = {
  race: 'Race',
  class: 'Class & Skills',
  abilities: 'Ability Scores',
  background: 'Background',
  equipment: 'Equipment',
  personality: 'Personality',
  portrait: 'Portrait',
  review: 'Review & Save',
}

export function WizardProgress({ step }: { step: WizardStep }) {
  const currentIndex = WIZARD_STEPS.indexOf(step)
  const percent = ((currentIndex + 1) / WIZARD_STEPS.length) * 100

  return (
    <div className="mb-8">
      <div className="mb-2 flex items-center justify-between text-sm">
        <span className="font-medium">
          Step {currentIndex + 1} of {WIZARD_STEPS.length}: {STEP_LABELS[step]}
        </span>
        <span className="text-muted-foreground">{Math.round(percent)}%</span>
      </div>
      <Progress value={percent}>
        <ProgressTrack>
          <ProgressIndicator style={{ width: `${percent}%` }} />
        </ProgressTrack>
      </Progress>
    </div>
  )
}
