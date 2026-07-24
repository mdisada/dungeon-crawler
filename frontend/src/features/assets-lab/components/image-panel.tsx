import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  IMAGE_PRESET_KEYS,
  IMAGE_PRESETS,
  uploadImageReference,
  useImageGeneration,
  type AssetRoute,
  type ImagePresetKey,
} from '@/features/image'
import type { LabRun } from '../types'
import { RouteControls, type WorkerState } from './route-controls'

interface Props {
  userId: string
  imageModelDefault: string
  worker: WorkerState
  onRecheckWorker: () => void
  onRun: (run: LabRun) => void
}

// OpenRouter always renders 1024x1024 (see generate-image.ts); the preset only shifts the prompt.
const CLOUD_INPUT = '1024x1024'

export function ImagePanel({ userId, imageModelDefault, worker, onRecheckWorker, onRun }: Props) {
  const [route, setRoute] = useState<AssetRoute>('openrouter')
  const [model, setModel] = useState('')
  const [usePlaceholder, setUsePlaceholder] = useState(false)
  const [preset, setPreset] = useState<ImagePresetKey>('base_char')
  const [prompt, setPrompt] = useState('')
  const [referencePath, setReferencePath] = useState<string | null>(null)
  const [refError, setRefError] = useState<string | null>(null)
  const { stage, error, isRunning, generate } = useImageGeneration()

  const acceptsReference = IMAGE_PRESETS[preset].maxReferences > 0

  async function handleReference(file: File) {
    setRefError(null)
    try {
      setReferencePath(await uploadImageReference(userId, file))
    } catch (err) {
      setRefError(err instanceof Error ? err.message : 'Reference upload failed')
    }
  }

  async function handleGenerate() {
    const startedAt = Date.now()
    const outcome = await generate({
      userId,
      route,
      preset,
      prompt,
      references: acceptsReference && referencePath ? [referencePath] : [],
      model: route === 'openrouter' && model.trim() ? model.trim() : undefined,
      usePlaceholder,
    })
    onRun({
      id: crypto.randomUUID(),
      medium: 'image',
      route,
      routeLabel: route === 'local' ? 'Local' : 'OpenRouter',
      model: route === 'local' ? 'worker' : model.trim() || imageModelDefault,
      variant: preset,
      input: route === 'openrouter' ? CLOUD_INPUT : `preset:${preset}`,
      totalMs: outcome?.durationMs ?? Date.now() - startedAt,
      firstAudioMs: null,
      marks: outcome?.marks ?? [],
      outputPaths: outcome ? [outcome.storagePath] : [],
      costUsd: null,
      error: outcome ? null : (error ?? 'failed'),
      startedAt,
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <RouteControls
        route={route}
        onRouteChange={setRoute}
        cloudLabel="OpenRouter"
        model={model}
        onModelChange={setModel}
        defaultModel={imageModelDefault}
        usePlaceholder={usePlaceholder}
        onPlaceholderChange={setUsePlaceholder}
        worker={worker}
        onRecheckWorker={onRecheckWorker}
      />

      <div className="flex flex-wrap gap-2">
        {IMAGE_PRESET_KEYS.map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setPreset(key)}
            className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
              preset === key ? 'border-foreground bg-muted' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {IMAGE_PRESETS[key].label}
          </button>
        ))}
      </div>
      <p className="text-xs text-muted-foreground">{IMAGE_PRESETS[preset].description}</p>

      <Textarea
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        rows={3}
        placeholder="Describe the subject (the preset adds framing and style)"
        aria-label="Image prompt"
      />

      {acceptsReference && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-muted-foreground">
            Reference image (up to {IMAGE_PRESETS[preset].maxReferences})
          </label>
          <input
            type="file"
            accept="image/*"
            aria-label="Reference image"
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) void handleReference(file)
              e.target.value = ''
            }}
          />
          {referencePath && <p className="text-xs text-muted-foreground">Reference ready.</p>}
          {refError && <p className="text-xs text-destructive">{refError}</p>}
        </div>
      )}

      <div className="flex items-center gap-3">
        <Button type="button" disabled={isRunning || !prompt.trim()} onClick={() => void handleGenerate()}>
          {isRunning ? `Generating${stage ? ` (${stage})` : ''}...` : 'Generate'}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  )
}
