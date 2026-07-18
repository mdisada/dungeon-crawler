import type { WizardDraft } from '../types'

export interface WizardStepProps {
  draft: WizardDraft
  updateDraft: (patch: Partial<WizardDraft>) => void
  goNext: () => void
  goBack: () => void
}
