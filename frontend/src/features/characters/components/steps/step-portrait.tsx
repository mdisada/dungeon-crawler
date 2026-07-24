import { useEffect, useRef, useState } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/features/auth'
import { uploadImageReference, useImageGeneration } from '@/features/image'
import { getAssetUrl } from '@/lib/asset-storage'
import { useAssetUrl } from '@/hooks/use-asset-url'
import { timeJob } from '@/lib/job-timer'
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
    race?.name,
    srdClass?.name,
    background && `${background.name} background`,
    physical || null,
    draft.freeformText || null,
  ]
    .filter(Boolean)
    .join(', ')
}

async function fetchBlob(url: string): Promise<Blob> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Could not read the current image')
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
  const { session } = useSession()
  const userId = session?.user.id ?? null

  const race = races.find((r) => r.key === draft.raceKey)
  const srdClass = classes.find((c) => c.key === draft.classKey)
  const background = backgrounds.find((b) => b.key === draft.backgroundKey)

  const [isSavingCrops, setIsSavingCrops] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  // The freshest full-body image as an `assets` bucket path (or a /placeholders/... path),
  // before its crops land in the characters bucket - also the source fed into image-to-image edits.
  const [workingPath, setWorkingPath] = useState<string | null>(null)
  const [cropPreviews, setCropPreviews] = useState<{ token: string; avatar: string; portrait: string } | null>(null)

  const { isRunning, stage, error: genError, generate, edit } = useImageGeneration()
  const workingUrl = useAssetUrl(workingPath)
  const storedFullbodyUrl = useCharacterImageUrl(draft.images.fullbodyUrl)
  const displayUrl = workingUrl ?? storedFullbodyUrl

  async function persistFullbody(path: string, displayable: string | undefined) {
    // Placeholder paths stay public-asset references; real generations get copied into the
    // owner-scoped characters bucket so the rest of the app resolves them the usual way.
    if (!characterId || path.startsWith('/') || !displayable) {
      updateDraft({ images: { ...draft.images, fullbodyUrl: path } })
      return
    }
    const blob = await fetchBlob(displayable)
    const { result: storedPath } = await timeJob('upload-character-image-fullbody', () =>
      uploadCharacterImage(characterId, 'fullbody', blob),
    )
    updateDraft({ images: { ...draft.images, fullbodyUrl: storedPath } })
  }

  async function runGenerate() {
    if (!userId) return
    const outcome = await generate({
      userId,
      route: 'openrouter',
      preset: 'base_char',
      prompt: assemblePrompt(draft, race, srdClass, background),
    })
    if (!outcome) return
    setWorkingPath(outcome.storagePath)
    setCropPreviews(null)
    const displayable = outcome.storagePath.startsWith('/')
      ? outcome.storagePath
      : await getAssetUrl(outcome.storagePath)
    await persistFullbody(outcome.storagePath, displayable)
  }

  // Auto-generate on first arrival: the wizard has the full description by this step, so the
  // initial portrait needs no button press (F02 review feedback).
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStartedRef.current || draft.images.fullbodyUrl || isRunning) return
    autoStartedRef.current = true
    void runGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-start on entry
  }, [])

  /** Returns an `assets` bucket path for whatever is displayed, uploading it as a reference if needed. */
  async function currentSourcePath(): Promise<string | null> {
    if (workingPath && !workingPath.startsWith('/')) return workingPath
    if (!userId || !displayUrl) return null
    const blob = await fetchBlob(displayUrl)
    const file = new File([blob], 'source.png', { type: blob.type || 'image/png' })
    return uploadImageReference(userId, file)
  }

  async function handleEdit() {
    if (!editText.trim() || !userId) return
    const sourcePath = await currentSourcePath()
    if (!sourcePath) return
    const outcome = await edit({
      userId,
      route: 'openrouter',
      preset: 'base_char',
      prompt: '',
      sourcePath,
      instruction: editText.trim(),
    })
    if (!outcome) return
    setWorkingPath(outcome.storagePath)
    setCropPreviews(null)
    const displayable = outcome.storagePath.startsWith('/')
      ? outcome.storagePath
      : await getAssetUrl(outcome.storagePath)
    await persistFullbody(outcome.storagePath, displayable)
    setEditText('')
  }

  async function handleCrops({ token, avatar, portrait }: CropOutputs) {
    if (!characterId) return
    setIsSavingCrops(true)
    setSaveError(null)
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
      setSaveError(err instanceof Error ? err.message : 'Failed to upload crops')
    } finally {
      setIsSavingCrops(false)
    }
  }

  const cropsDone = Boolean(draft.images.tokenUrl && draft.images.avatarUrl && draft.images.portraitUrl)
  const error = genError ?? saveError

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Portrait</h2>

      {isRunning && (
        <p className="mb-4 text-sm text-muted-foreground">Generating portrait{stage ? ` (${stage})` : ''}...</p>
      )}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {displayUrl && !isRunning && (
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
                  disabled={!editText.trim() || isRunning}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Apply edit
                </button>
                <button
                  type="button"
                  onClick={() => void runGenerate()}
                  disabled={isRunning}
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
