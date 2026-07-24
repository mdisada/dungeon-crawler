import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AssetRoute } from '@/features/image'
import {
  isFishModel,
  useSynthesis,
  useVoiceProfiles,
  VOXTRAL_VOICES,
  type VoiceSelection,
} from '@/features/tts'
import type { LabRun } from '../types'
import { RouteControls, type WorkerState } from './route-controls'

interface Props {
  userId: string
  ttsModelDefault: string
  worker: WorkerState
  onRecheckWorker: () => void
  onRun: (run: LabRun) => void
}

export function TtsPanel({ userId, ttsModelDefault, worker, onRecheckWorker, onRun }: Props) {
  const [route, setRoute] = useState<AssetRoute>('openrouter')
  const [model, setModel] = useState('')
  const [usePlaceholder, setUsePlaceholder] = useState(false)
  const [text, setText] = useState('')
  const [voiceId, setVoiceId] = useState<string | null>(null)
  const [voxtralSlug, setVoxtralSlug] = useState(VOXTRAL_VOICES[0].slug)
  const [referenceId, setReferenceId] = useState('')
  const [localPreset, setLocalPreset] = useState('')
  const { profiles, error: voiceError, upload } = useVoiceProfiles(userId)
  const { stage, error, isRunning, run } = useSynthesis()

  // ai-proxy routes a cloud tts call to Fish or Voxtral by the model id; the panel mirrors that to
  // show the right voice controls. Blank model field => the user's default (now a Fish engine).
  const effectiveModel = model.trim() || ttsModelDefault
  const cloudProvider = isFishModel(effectiveModel) ? 'fish' : 'voxtral'
  const cloudLabel = cloudProvider === 'fish' ? 'Fish Audio' : 'Voxtral (OpenRouter)'
  const workerVoices = worker.status === 'online' ? worker.capabilities.ttsVoices : []

  function currentVoice(): VoiceSelection | null {
    if (route === 'local') {
      const profile = profiles.find((p) => p.id === voiceId)
      if (profile) return { kind: 'profile', profile }
      if (localPreset.trim()) return { kind: 'preset', voiceId: localPreset.trim() }
      return { kind: 'default' }
    }
    if (cloudProvider === 'voxtral') {
      return voxtralSlug.trim() ? { kind: 'preset', voiceId: voxtralSlug.trim() } : null
    }
    // Fish: an uploaded profile is cloned; a reference_id names a library voice; neither uses the
    // Fish default voice.
    const profile = profiles.find((p) => p.id === voiceId)
    if (profile) return { kind: 'profile', profile }
    if (referenceId.trim()) return { kind: 'preset', voiceId: referenceId.trim() }
    return { kind: 'default' }
  }

  function describeVoice(voice: VoiceSelection): string {
    if (voice.kind === 'profile') return `clone:${voice.profile.name}`
    if (voice.kind === 'preset') return `preset:${voice.voiceId}`
    return 'default'
  }

  async function handleUpload(file: File) {
    const profile = await upload(file.name.replace(/\.[^.]+$/, ''), file)
    if (profile) setVoiceId(profile.id)
  }

  async function handleSynthesize() {
    const voice = currentVoice()
    if (!voice) return
    const startedAt = Date.now()
    const outcome = await run({
      userId,
      route,
      text,
      voice,
      model: route === 'openrouter' ? effectiveModel : undefined,
      usePlaceholder,
    })
    onRun({
      id: crypto.randomUUID(),
      medium: 'tts',
      route,
      routeLabel: route === 'local' ? 'Local' : cloudLabel,
      model:
        route === 'local'
          ? worker.status === 'online'
            ? worker.capabilities.ttsBackend ?? 'worker'
            : 'worker'
          : effectiveModel,
      variant: describeVoice(voice),
      input: `${text.trim().length} chars`,
      totalMs: outcome?.durationMs ?? Date.now() - startedAt,
      firstAudioMs: outcome?.firstAudioMs ?? null,
      marks: outcome?.marks ?? [],
      outputPaths: outcome?.chunks ?? [],
      costUsd: null,
      error: outcome ? null : (error ?? 'failed'),
      startedAt,
    })
  }

  const profilePicker = (label: string) => (
    <div className="flex flex-col gap-1">
      <label htmlFor="tts-voice" className="text-xs text-muted-foreground">
        {label}
      </label>
      <select
        id="tts-voice"
        value={voiceId ?? ''}
        onChange={(e) => setVoiceId(e.target.value || null)}
        className="h-9 w-56 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Provider default voice</option>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
    </div>
  )

  const uploadButton = (
    <label className="flex h-9 cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted">
      Upload clip
      <input
        type="file"
        accept="audio/*"
        className="hidden"
        aria-label="Upload voice clip"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleUpload(file)
          e.target.value = ''
        }}
      />
    </label>
  )

  return (
    <div className="flex flex-col gap-4">
      <RouteControls
        route={route}
        onRouteChange={setRoute}
        cloudLabel={cloudLabel}
        model={model}
        onModelChange={setModel}
        defaultModel={ttsModelDefault}
        usePlaceholder={usePlaceholder}
        onPlaceholderChange={setUsePlaceholder}
        worker={worker}
        onRecheckWorker={onRecheckWorker}
      />

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={4}
        placeholder="Text to synthesize"
        aria-label="Text to synthesize"
      />

      {route === 'openrouter' && cloudProvider === 'fish' && (
        <div className="flex flex-wrap items-end gap-4">
          {profilePicker('Voice (upload a clip to clone, or use a reference_id / default)')}
          {uploadButton}
          <div className="flex flex-col gap-1">
            <label htmlFor="fish-reference" className="text-xs text-muted-foreground">
              or Fish reference_id
            </label>
            <input
              id="fish-reference"
              value={referenceId}
              onChange={(e) => setReferenceId(e.target.value)}
              placeholder="a Fish voice model id"
              className="h-9 w-56 rounded-md border bg-background px-2 font-mono text-xs"
            />
          </div>
        </div>
      )}

      {route === 'openrouter' && cloudProvider === 'voxtral' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="voxtral-slug" className="text-xs text-muted-foreground">
            Voxtral preset voice (no cloning on this provider)
          </label>
          <input
            id="voxtral-slug"
            list="voxtral-voices"
            value={voxtralSlug}
            onChange={(e) => setVoxtralSlug(e.target.value)}
            className="h-9 w-72 rounded-md border bg-background px-2 font-mono text-xs"
          />
          <datalist id="voxtral-voices">
            {VOXTRAL_VOICES.map((voice) => (
              <option key={voice.slug} value={voice.slug}>
                {voice.label}
              </option>
            ))}
          </datalist>
        </div>
      )}

      {route === 'local' && (
        <div className="flex flex-wrap items-end gap-4">
          {profilePicker('Voice profile (clone)')}
          <div className="flex flex-col gap-1">
            <label htmlFor="tts-preset-voice" className="text-xs text-muted-foreground">
              or worker preset id
            </label>
            <input
              id="tts-preset-voice"
              list="tts-worker-voices"
              value={localPreset}
              onChange={(e) => setLocalPreset(e.target.value)}
              placeholder={workerVoices[0] ?? 'am_michael'}
              className="h-9 w-56 rounded-md border bg-background px-2 font-mono text-xs"
            />
            <datalist id="tts-worker-voices">
              {workerVoices.map((voice) => (
                <option key={voice} value={voice} />
              ))}
            </datalist>
          </div>
          {uploadButton}
        </div>
      )}
      {voiceError && <p className="text-xs text-destructive">{voiceError}</p>}

      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={isRunning || !text.trim() || !currentVoice()}
          onClick={() => void handleSynthesize()}
        >
          {isRunning ? `Synthesizing${stage ? ` (${stage})` : ''}...` : 'Synthesize'}
        </Button>
        {error && <span className="text-sm text-destructive">{error}</span>}
      </div>
    </div>
  )
}
