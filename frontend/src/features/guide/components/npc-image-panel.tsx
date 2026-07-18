import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { TokenCropTool, type CropOutputs } from '@/features/characters'
import { generateGuideImage, uploadAdventureMedia } from '../api/images'
import { saveGuideRow } from '../api/save-guide-row'
import { useMediaUrl } from '../hooks/use-media-url'
import type { Npc } from '../types'

interface NpcImagePanelProps {
  adventureId: string
  npc: Npc
  onChanged: () => void
}

// F04 SS5.2: images NEVER auto-generate - the per-NPC prompt is shown and generation is an
// explicit click; crops flow through the F2 tool (avatar/token/portrait derived from one rect).
export function NpcImagePanel({ adventureId, npc, onChanged }: NpcImagePanelProps) {
  const [prompt, setPrompt] = useState(npc.imagePrompt)
  const [pendingSourceUrl, setPendingSourceUrl] = useState<string | null>(null)
  const [pendingBlob, setPendingBlob] = useState<Blob | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const portraitUrl = useMediaUrl(npc.images.portrait ?? null)

  async function generate() {
    setIsBusy(true)
    setError(null)
    try {
      if (prompt !== npc.imagePrompt) await saveGuideRow('npcs', npc.id, { image_prompt: prompt })
      const blob = await generateGuideImage(adventureId, prompt, 'npc')
      setPendingBlob(blob)
      setPendingSourceUrl(URL.createObjectURL(blob))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Image generation failed')
    } finally {
      setIsBusy(false)
    }
  }

  async function handleCrops(crops: CropOutputs) {
    if (!pendingBlob) return
    setIsBusy(true)
    setError(null)
    try {
      const base = `npcs/${npc.id}`
      const images = {
        fullbody: await uploadAdventureMedia(adventureId, `${base}/fullbody.png`, pendingBlob),
        token: await uploadAdventureMedia(adventureId, `${base}/token.png`, crops.token),
        avatar: await uploadAdventureMedia(adventureId, `${base}/avatar.png`, crops.avatar),
        portrait: await uploadAdventureMedia(adventureId, `${base}/portrait.png`, crops.portrait),
      }
      await saveGuideRow('npcs', npc.id, { images })
      setPendingSourceUrl(null)
      setPendingBlob(null)
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
      {portraitUrl && !pendingSourceUrl && (
        <img src={portraitUrl} alt={`${npc.name} portrait`} className="h-40 w-30 rounded-md object-cover" />
      )}
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">
        Image prompt
        <Textarea
          className="min-h-16 text-sm text-foreground"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
        />
      </label>
      <div>
        <Button size="sm" disabled={isBusy || prompt.trim().length === 0} onClick={() => void generate()}>
          {npc.images.portrait ? 'Regenerate image' : 'Generate image'}
        </Button>
      </div>
      {pendingSourceUrl && (
        <div className="flex flex-col gap-2">
          <p className="text-xs text-muted-foreground">Frame the token (head) - avatar and portrait derive from it.</p>
          <TokenCropTool sourceUrl={pendingSourceUrl} onCrops={(crops) => void handleCrops(crops)} isBusy={isBusy} />
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </section>
  )
}
