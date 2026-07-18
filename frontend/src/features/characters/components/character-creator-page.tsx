import { useNavigate, useParams } from 'react-router-dom'

import { useSession } from '@/features/auth'
import { useCharacterDraft } from '../hooks/use-character-draft'
import { useSrdReferenceData } from '../hooks/use-srd-reference-data'
import { StepAbilities } from './steps/step-abilities'
import { StepBackground } from './steps/step-background'
import { StepClass } from './steps/step-class'
import { StepEquipment } from './steps/step-equipment'
import { StepPersonality } from './steps/step-personality'
import { StepPortrait } from './steps/step-portrait'
import { StepRace } from './steps/step-race'
import { StepReview } from './steps/step-review'
import { WizardProgress } from './wizard-progress'

export function CharacterCreatorPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useSession()
  const userId = session?.user.id
  const {
    races,
    classes,
    backgrounds,
    feats,
    isLoading: isLoadingReference,
    error: referenceError,
  } = useSrdReferenceData()
  const { characterId, draft, isLoading, isSaving, error, updateDraft, goNext, goBack, finalize } = useCharacterDraft(
    userId,
    id,
  )

  if (isLoading || isLoadingReference) {
    return <p className="p-8 text-muted-foreground">Loading…</p>
  }

  if (referenceError || error) {
    return <p className="p-8 text-destructive">{referenceError ?? error}</p>
  }

  const srdClass = classes.find((c) => c.key === draft.classKey)
  const background = backgrounds.find((b) => b.key === draft.backgroundKey)

  async function handleSave() {
    if (!srdClass) return
    await finalize(srdClass)
    navigate(`/characters/${characterId}`)
  }

  return (
    <div className="w-full max-w-3xl">
      <WizardProgress step={draft.step} />

      {draft.step === 'race' && (
        <StepRace draft={draft} updateDraft={updateDraft} goNext={goNext} goBack={goBack} races={races} />
      )}
      {draft.step === 'class' && (
        <StepClass
          draft={draft}
          updateDraft={updateDraft}
          goNext={goNext}
          goBack={goBack}
          classes={classes}
          background={background}
        />
      )}
      {draft.step === 'abilities' && (
        <StepAbilities draft={draft} updateDraft={updateDraft} goNext={goNext} goBack={goBack} />
      )}
      {draft.step === 'background' && (
        <StepBackground
          draft={draft}
          updateDraft={updateDraft}
          goNext={goNext}
          goBack={goBack}
          backgrounds={backgrounds}
          feats={feats}
        />
      )}
      {draft.step === 'equipment' && (
        <StepEquipment
          draft={draft}
          updateDraft={updateDraft}
          goNext={goNext}
          goBack={goBack}
          srdClass={srdClass}
          background={background}
        />
      )}
      {draft.step === 'personality' && (
        <StepPersonality
          draft={draft}
          updateDraft={updateDraft}
          goNext={goNext}
          goBack={goBack}
          characterId={characterId}
        />
      )}
      {draft.step === 'portrait' && (
        <StepPortrait
          draft={draft}
          updateDraft={updateDraft}
          goNext={goNext}
          goBack={goBack}
          characterId={characterId}
          races={races}
          classes={classes}
          backgrounds={backgrounds}
        />
      )}
      {draft.step === 'review' && (
        <StepReview
          draft={draft}
          updateDraft={updateDraft}
          goNext={goNext}
          goBack={goBack}
          races={races}
          classes={classes}
          backgrounds={backgrounds}
          onSave={() => void handleSave()}
          isSaving={isSaving}
        />
      )}
    </div>
  )
}
