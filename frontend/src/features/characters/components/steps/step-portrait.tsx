import { useEffect, useRef, useState } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { timeJob } from '@/lib/job-timer'
import { editPortrait, generatePortrait } from '../../api/generate-portrait'
import { uploadCharacterImage } from '../../api/upload-character-image'
import { useCharacterImageUrl } from '../../hooks/use-character-image-url'
import { TokenCropTool, type CropOutputs } from '../token-crop-tool'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'
import type { SrdBackground, SrdClass, SrdRace, WizardDraft } from '../../types'

function assemblePrompt(
  draft: WizardDraft,
  race: SrdRace | undefined,
  srdClass: SrdClass | undefined,
  background: SrdBackground | undefined,
): string {
  const physical = [
    draft.physical.age && `age ${draft.physical.age}`,
    draft.physical.height && `${draft.physical.height} tall`,
    draft.physical.hair && `${draft.physical.hair} hair`,
    draft.physical.eyes && `${draft.physical.eyes} eyes`,
    draft.physical.description,
  ]
    .filter(Boolean)
    .join(', ')

  return [
    'Full-body fantasy character portrait, standing pose, plain background, 9:16',
    race?.name,
    srdClass?.name,
    background && `${background.name} background`,
    physical || null,
    draft.freeformText || null,
  ]
    .filter(Boolean)
    .join(', ')
}

async function toDataUrl(url: string): Promise<string> {
  const res = await fetch(url)
  const blob = await res.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.readAsDataURL(blob)
  })
}

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl)
  return res.blob()
}

export function StepPortrait({
  draft,
  updateDraft,
  goNext,
  goBack,
  characterId,
  races,
  classes,
  backgrounds,
}: WizardStepProps & {
  characterId: string | null
  races: SrdRace[]
  classes: SrdClass[]
  backgrounds: SrdBackground[]
}) {
  const race = races.find((r) => r.key === draft.raceKey)
  const srdClass = classes.find((c) => c.key === draft.classKey)
  const background = backgrounds.find((b) => b.key === draft.backgroundKey)

  const [isGenerating, setIsGenerating] = useState(false)
  const [isSavingCrops, setIsSavingCrops] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  // The freshest full-body image as a data/placeholder URL, before it lands in Storage - also
  // what gets fed back into image-to-image edits.
  const [workingImage, setWorkingImage] = useState<string | null>(null)
  const [cropPreviews, setCropPreviews] = useState<{ token: string; avatar: string; portrait: string } | null>(null)

  const storedFullbodyUrl = useCharacterImageUrl(draft.images.fullbodyUrl)
  const displayUrl = workingImage ?? storedFullbodyUrl

  async function persistFullbody(imageUrl: string) {
    // Placeholder path stays a public-asset reference; real generations go to Storage.
    if (!characterId || imageUrl.startsWith('/')) {
      updateDraft({ images: { ...draft.images, fullbodyUrl: imageUrl } })
      return
    }
    const blob = await dataUrlToBlob(imageUrl)
    const { result: path } = await timeJob('upload-character-image-fullbody', () =>
      uploadCharacterImage(characterId, 'fullbody', blob),
    )
    updateDraft({ images: { ...draft.images, fullbodyUrl: path } })
  }

  async function runGeneration(fn: () => Promise<string>, label: string) {
    setIsGenerating(true)
    setError(null)
    try {
      const { result: imageUrl } = await timeJob(label, fn)
      setWorkingImage(imageUrl)
      setCropPreviews(null)
      await persistFullbody(imageUrl)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  // Auto-generate on first arrival: the wizard has the full description by this step, so the
  // initial portrait needs no button press (F02 review feedback).
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStartedRef.current || draft.images.fullbodyUrl || isGenerating) return
    autoStartedRef.current = true
    void runGeneration(() => generatePortrait(assemblePrompt(draft, race, srdClass, background)), 'generate-portrait')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-start on entry
  }, [])

  async function handleEdit() {
    if (!editText.trim() || !displayUrl) return
    const current = displayUrl.startsWith('data:') ? displayUrl : await toDataUrl(displayUrl)
    await runGeneration(() => editPortrait(current, editText.trim()), 'edit-portrait')
    setEditText('')
  }

  async function handleCrops({ token, avatar, portrait }: CropOutputs) {
    if (!characterId) return
    setIsSavingCrops(true)
    setError(null)
    setCropPreviews({
      token: URL.createObjectURL(token),
      avatar: URL.createObjectURL(avatar),
      portrait: URL.createObjectURL(portrait),
    })
    try {
      const [tokenPath, avatarPath, portraitPath] = await Promise.all([
        timeJob('upload-character-image-token', () => uploadCharacterImage(characterId, 'token', token)),
        timeJob('upload-character-image-avatar', () => uploadCharacterImage(characterId, 'avatar', avatar)),
        timeJob('upload-character-image-portrait', () => uploadCharacterImage(characterId, 'portrait', portrait)),
      ])
      updateDraft({
        images: {
          ...draft.images,
          tokenUrl: tokenPath.result,
          avatarUrl: avatarPath.result,
          portraitUrl: portraitPath.result,
        },
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload crops')
    } finally {
      setIsSavingCrops(false)
    }
  }

  const cropsDone = Boolean(draft.images.tokenUrl && draft.images.avatarUrl && draft.images.portraitUrl)

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Portrait</h2>

      {isGenerating && <p className="mb-4 text-sm text-muted-foreground">Generating portrait…</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {displayUrl && !isGenerating && (
        <div className="flex flex-wrap gap-8">
          <div>
            <img
              src={displayUrl}
              alt="Generated full-body character portrait"
              className="w-52 rounded-md border"
            />
            <div className="mt-3 max-w-52">
              <Textarea
                value={editText}
                onChange={(e) => setEditText(e.target.value)}
                rows={2}
                placeholder="Describe a change (e.g. 'give her a scar over the left eye')"
                aria-label="Describe an image edit"
              />
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => void handleEdit()}
                  disabled={!editText.trim() || isGenerating}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Apply edit
                </button>
                <button
                  type="button"
                  onClick={() =>
                    void runGeneration(
                      () => generatePortrait(assemblePrompt(draft, race, srdClass, background)),
                      'generate-portrait',
                    )
                  }
                  disabled={isGenerating}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Regenerate from scratch
                </button>
              </div>
            </div>
          </div>

          <div>
            <TokenCropTool sourceUrl={displayUrl} onCrops={(c) => void handleCrops(c)} isBusy={isSavingCrops} />

            {cropPreviews && (
              <div className="mt-4">
                <p className="mb-2 text-xs font-medium text-muted-foreground">Derived image set</p>
                <div className="flex items-end gap-3">
                  <figure>
                    <img
                      src={cropPreviews.token}
                      alt="Token crop preview"
                      className="size-12 rounded-full border object-cover"
                    />
                    <figcaption className="mt-1 text-center text-xs text-muted-foreground">Token</figcaption>
                  </figure>
                  <figure>
                    <img src={cropPreviews.avatar} alt="Avatar crop preview" className="size-16 rounded-md border" />
                    <figcaption className="mt-1 text-center text-xs text-muted-foreground">Avatar</figcaption>
                  </figure>
                  <figure>
                    <img src={cropPreviews.portrait} alt="Half-body portrait crop preview" className="h-32 rounded-md border" />
                    <figcaption className="mt-1 text-center text-xs text-muted-foreground">Portrait</figcaption>
                  </figure>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <StepNav onBack={goBack} onNext={goNext} nextDisabled={!cropsDone} />
    </div>
  )
}
