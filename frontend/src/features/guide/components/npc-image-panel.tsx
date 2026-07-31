import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TokenCropTool, type CropOutputs } from '@/features/image'
import { generateNpcImages } from '../api/npc-images'
import { uploadAdventureMedia } from '../api/images'
import { saveGuideImages, saveGuideRow } from '../api/save-guide-row'
import { useMediaUrl } from '../hooks/use-media-url'
import type { Npc } from '../types'

interface NpcImagePanelProps {
  adventureId: string
  npc: Npc
  onChanged: () => void
}

/**
 * F04 SS5.2, revised 2026-07-31: images now generate automatically for the whole cast after the
 * pipeline finishes (see use-npc-image-pass), and the crops are framed from the cutout's
 * silhouette. This panel is the override - regenerate one NPC, or re-frame crops the measurement
 * got wrong, using the same tool the character creator uses.
 */
export function NpcImagePanel({ adventureId, npc, onChanged }: NpcImagePanelProps) {
  const [prompt, setPrompt] = useState(npc.imagePrompt)
  const [isBusy, setIsBusy] = useState(false)
  const [isCropping, setIsCropping] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const portraitUrl = useMediaUrl(npc.images.portrait ?? null)
  const tokenUrl = useMediaUrl(npc.images.token ?? null)
  // Crops come off the cutout; an NPC whose backdrop could not be keyed falls back to the original.
  const cropSourceUrl = useMediaUrl(npc.images.base ?? npc.images.original ?? npc.images.fullbody ?? null)

  async function regenerate() {
    setIsBusy(true)
    setError(null)
    try {
      if (prompt !== npc.imagePrompt) await saveGuideRow('npcs', npc.id, { image_prompt: prompt })
      await generateNpcImages(adventureId, { ...npc, imagePrompt: prompt })
      setIsCropping(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleCrops({ token, portrait, tokenBackground }: CropOutputs) {
    setIsBusy(true)
    setError(null)
    try {
      const dir = `npcs/${npc.id}`
      const images = {
        ...npc.images,
        token: await uploadAdventureMedia(adventureId, `${dir}/token.png`, token),
        portrait: await uploadAdventureMedia(adventureId, `${dir}/portrait.png`, portrait),
        tokenBackground,
      }
      await saveGuideImages('npcs', npc.id, images)
      setIsCropping(false)
      onChanged()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image upload failed')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <section className="flex flex-col gap-2">
      <h3 className="text-sm font-semibold">Images</h3>

      <div className="flex items-end gap-3">
        {portraitUrl ? (
          <figure className="m-0">
            <img src={portraitUrl} alt={`${npc.name} portrait`} className="h-40 w-30 rounded-md border object-cover" />
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">Portrait</figcaption>
          </figure>
        ) : (
          <p className="text-xs text-muted-foreground">No portrait yet.</p>
        )}
        {tokenUrl && (
          <figure className="m-0">
            <img src={tokenUrl} alt={`${npc.name} token`} className="size-12 rounded-full border object-cover" />
            <figcaption className="mt-1 text-center text-xs text-muted-foreground">Token</figcaption>
          </figure>
        )}
      </div>

      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Image prompt
        <Textarea
          className="min-h-16 text-sm text-foreground"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={isBusy || prompt.trim().length === 0} onClick={() => void regenerate()}>
          {isBusy ? 'Working…' : npc.images.original || npc.images.fullbody ? 'Regenerate image' : 'Generate image'}
        </Button>
        {cropSourceUrl && (
          <Button size="sm" variant="outline" disabled={isBusy} onClick={() => setIsCropping((v) => !v)}>
            {isCropping ? 'Cancel re-crop' : 'Re-crop'}
          </Button>
        )}
      </div>

      {isCropping && cropSourceUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">
            Frame the head - the portrait derives from it. Replaces the automatic framing.
          </p>
          <TokenCropTool sourceUrl={cropSourceUrl} onCrops={(crops) => void handleCrops(crops)} isBusy={isBusy} />
        </div>
      )}

      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  )
}
