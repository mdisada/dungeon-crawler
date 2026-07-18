import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  ttsModel: string
  imageModel: string
  embeddingModel: string
  onChangeTtsModel: (model: string) => void
  onChangeImageModel: (model: string) => void
}

export function MediaModelsSection({ ttsModel, imageModel, embeddingModel, onChangeTtsModel, onChangeImageModel }: Props) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium">Media models</h2>
      <div className="flex flex-col gap-2">
        <Label htmlFor="tts-model">TTS model</Label>
        <Input id="tts-model" value={ttsModel} onChange={(e) => onChangeTtsModel(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="image-model">Image model</Label>
        <Input id="image-model" value={imageModel} onChange={(e) => onChangeImageModel(e.target.value)} />
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="embedding-model">Embedding model</Label>
        <Input id="embedding-model" value={embeddingModel} disabled />
        <p className="text-sm text-muted-foreground">
          Fixed -- changing this would invalidate every existing embedding. A re-embed job isn't
          built yet (F13).
        </p>
      </div>
    </section>
  )
}
