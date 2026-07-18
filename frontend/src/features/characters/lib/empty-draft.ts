import type { WizardDraft, WizardStep } from '../types'
import { WIZARD_STEPS } from '../types'

export function emptyWizardDraft(): WizardDraft {
  return {
    step: 'race',
    name: '',
    raceKey: null,
    classKey: null,
    abilityMethod: 'standard_array',
    // Standard Array pre-assigned in descending order so the step starts valid - players swap
    // values around rather than building an assignment from scratch (F02 review feedback).
    baseAbilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    backgroundKey: null,
    abilityBonuses: {},
    skillProficiencies: [],
    toolProficiencies: [],
    classEquipmentChoice: null,
    equipmentChoice: null,
    alignment: '',
    personality: { traits: '', ideals: '', bonds: '', flaws: '' },
    freeformText: '',
    physical: { age: '', height: '', hair: '', eyes: '', description: '' },
    voice: { source: 'default' },
    images: {},
    backgroundNarrative: '',
  }
}

// Drafts saved by older wizard versions may miss newer fields (voice, classEquipmentChoice) or
// reference a removed step ('skills-equipment' merged into class/equipment). Merge over the
// empty draft and remap so old drafts keep working instead of crashing the wizard.
export function normalizeDraft(stored: Omit<Partial<WizardDraft>, 'step'> & { step?: string }): WizardDraft {
  const base = emptyWizardDraft()
  const step: WizardStep =
    stored.step === 'skills-equipment'
      ? 'equipment'
      : WIZARD_STEPS.includes(stored.step as WizardStep)
        ? (stored.step as WizardStep)
        : 'race'
  return { ...base, ...stored, step, voice: stored.voice ?? base.voice }
}
