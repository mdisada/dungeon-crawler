import { useEffect, useRef, useState } from 'react'

import { Textarea } from '@/components/ui/textarea'
import { useSession } from '@/features/auth'
import {
  BackdropNotKeyableError,
  removeImageBackground,
  TokenCropTool,
  uploadImageReference,
  useImageGeneration,
  type CropOutputs,
} from '@/features/image'
import { getAssetUrl } from '@/lib/asset-storage'
import { useAssetUrl } from '@/hooks/use-asset-url'
import { timeJob } from '@/lib/job-timer'
import { uploadCharacterImage } from '../../api/upload-character-image'
import { useCharacterImageUrl } from '../../hooks/use-character-image-url'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'
import type { CharacterImages, SrdBackground, SrdClass, SrdRace, WizardDraft } from '../../types'

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
  const [isCuttingOut, setIsCuttingOut] = useState(false)
  // The freshest generation as an `assets` bucket path (or a /placeholders/... path) - what an
  // image-to-image edit is applied to, before anything is cropped.
  const [workingPath, setWorkingPath] = useState<string | null>(null)
  // The background-removed base as a local object URL. Held locally as well as uploaded because a
  // same-origin blob URL is what the crop canvas reads without any CORS question.
  const [baseObjectUrl, setBaseObjectUrl] = useState<string | null>(null)
  const [cropPreviews, setCropPreviews] = useState<{ token: string; portrait: string } | null>(null)

  const { isRunning, stage, error: genError, generate, edit } = useImageGeneration()
  const workingUrl = useAssetUrl(workingPath)
  const storedOriginalUrl = useCharacterImageUrl(draft.images.originalUrl ?? draft.images.fullbodyUrl)
  const storedBaseUrl = useCharacterImageUrl(draft.images.baseUrl)
  const originalUrl = workingUrl ?? storedOriginalUrl
  // Crops always come off the cutout. Only a character created before 2026-07-31 (no base stored,
  // none derived this visit) falls back to the original, background and all.
  const cropSourceUrl = baseObjectUrl ?? storedBaseUrl ?? originalUrl

  // One object URL is alive at a time; the previous one is revoked as soon as it is replaced.
  const baseObjectUrlRef = useRef<string | null>(null)
  function holdBaseObjectUrl(next: string | null) {
    if (baseObjectUrlRef.current) URL.revokeObjectURL(baseObjectUrlRef.current)
    baseObjectUrlRef.current = next
    setBaseObjectUrl(next)
  }
  useEffect(() => () => holdBaseObjectUrl(null), [])

  /**
   * original -> base -> (the player frames the crops). A new original invalidates the crops that
   * came off the old one, so they are cleared here rather than left pointing at a character who no
   * longer looks like that; Next stays disabled until the crops are re-framed.
   */
  async function derive(storagePath: string) {
    setWorkingPath(storagePath)
    setCropPreviews(null)
    holdBaseObjectUrl(null)
    setSaveError(null)

    const isPlaceholder = storagePath.startsWith('/')
    const displayable = isPlaceholder ? storagePath : await getAssetUrl(storagePath)
    const next: CharacterImages = {
      ...draft.images,
      tokenUrl: undefined,
      portraitUrl: undefined,
      originalUrl: storagePath,
      baseUrl: undefined,
    }

    // Placeholder paths stay public-asset references; real generations get copied into the
    // owner-scoped characters bucket so the rest of the app resolves them the usual way.
    if (characterId && !isPlaceholder) {
      const original = await fetchBlob(displayable)
      const { result: originalPath } = await timeJob('upload-character-image-original', () =>
        uploadCharacterImage(characterId, 'original', original),
      )
      next.originalUrl = originalPath

      try {
        setIsCuttingOut(true)
        const { result: base } = await timeJob('remove-character-image-background', () =>
          removeImageBackground(original),
        )
        holdBaseObjectUrl(URL.createObjectURL(base))
        const { result: basePath } = await timeJob('upload-character-image-base', () =>
          uploadCharacterImage(characterId, 'base', base),
        )
        next.baseUrl = basePath
      } catch (err) {
        // A failed cutout must not cost the player the generation they just waited for: the
        // original is already stored, and the crop tool falls back to it.
        setSaveError(
          err instanceof BackdropNotKeyableError
            ? 'This image came back without the flat backdrop the cutout needs, so its crops will ' +
              'keep the background. Regenerate to try again.'
            : `Background removal failed (${err instanceof Error ? err.message : 'unknown error'}). ` +
              'Crops will keep the generated background - regenerate to try again.',
        )
      } finally {
        setIsCuttingOut(false)
      }
    }

    updateDraft({ images: next })
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
    await derive(outcome.storagePath)
  }

  // Auto-generate on first arrival: the wizard has the full description by this step, so the
  // initial portrait needs no button press (F02 review feedback).
  const autoStartedRef = useRef(false)
  useEffect(() => {
    if (autoStartedRef.current || draft.images.originalUrl || draft.images.fullbodyUrl || isRunning) return
    autoStartedRef.current = true
    void runGenerate()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot auto-start on entry
  }, [])

  /** Returns an `assets` bucket path for the current original, uploading it as a reference if needed. */
  async function currentSourcePath(): Promise<string | null> {
    if (workingPath && !workingPath.startsWith('/')) return workingPath
    if (!userId || !originalUrl) return null
    const blob = await fetchBlob(originalUrl)
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
    await derive(outcome.storagePath)
    setEditText('')
  }

  async function handleCrops({ token, portrait, tokenBackground }: CropOutputs) {
    if (!characterId) return
    setIsSavingCrops(true)
    setSaveError(null)
    setCropPreviews({ token: URL.createObjectURL(token), portrait: URL.createObjectURL(portrait) })
    try {
      const [tokenPath, portraitPath] = await Promise.all([
        timeJob('upload-character-image-token', () => uploadCharacterImage(characterId, 'token', token)),
        timeJob('upload-character-image-portrait', () => uploadCharacterImage(characterId, 'portrait', portrait)),
      ])
      updateDraft({
        images: {
          ...draft.images,
          tokenUrl: tokenPath.result,
          portraitUrl: portraitPath.result,
          tokenBackground,
        },
      })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to upload crops')
    } finally {
      setIsSavingCrops(false)
    }
  }

  const cropsDone = Boolean(draft.images.tokenUrl && draft.images.portraitUrl)
  const error = genError ?? saveError

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Portrait</h2>

      {isRunning && (
        <p className="mb-4 text-sm text-muted-foreground">Generating portrait{stage ? ` (${stage})` : ''}...</p>
      )}
      {isCuttingOut && <p className="mb-4 text-sm text-muted-foreground">Removing the background...</p>}
      {error && <p className="mb-4 text-sm text-destructive">{error}</p>}

      {originalUrl && !isRunning && (
        <div className="flex flex-wrap gap-8">
          <div>
            <img src={originalUrl} alt="Generated full-body character portrait" className="w-52 rounded-md border" />
            <p className="mt-1 text-xs text-muted-foreground">Original</p>
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
                  disabled={!editText.trim() || isRunning || isCuttingOut}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Apply edit
                </button>
                <button
                  type="button"
                  onClick={() => void runGenerate()}
                  disabled={isRunning || isCuttingOut}
                  className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50"
                >
                  Regenerate from scratch
                </button>
              </div>
            </div>
          </div>

          {cropSourceUrl && !isCuttingOut && (
            <div>
              <TokenCropTool sourceUrl={cropSourceUrl} onCrops={(c) => void handleCrops(c)} isBusy={isSavingCrops} />

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
                      <img
                        src={cropPreviews.portrait}
                        alt="Half-body portrait crop preview"
                        className="h-32 rounded-md border"
                      />
                      <figcaption className="mt-1 text-center text-xs text-muted-foreground">Portrait</figcaption>
                    </figure>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <StepNav onBack={goBack} onNext={goNext} nextDisabled={!cropsDone} />
    </div>
  )
}
