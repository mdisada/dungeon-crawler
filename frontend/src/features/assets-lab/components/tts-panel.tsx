import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import type { AssetRoute } from '@/features/image'
import {
  DEFAULT_VOXTRAL_VOICE,
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
  // Cloud: a Voxtral preset slug. Local: a worker preset id (Kokoro) or blank when cloning.
  const [cloudVoice, setCloudVoice] = useState(DEFAULT_VOXTRAL_VOICE)
  const [localPreset, setLocalPreset] = useState('')
  const { profiles, error: voiceError, upload } = useVoiceProfiles(userId)
  const { stage, error, isRunning, run } = useSynthesis()

  // Local Kokoro (CPU) offers only preset voices; the worker reports them in capabilities.
  const workerVoices = worker.status === 'online' ? worker.capabilities.ttsVoices : []
  const canCloneLocal = worker.status === 'online' && worker.capabilities.cloning

  // OpenRouter can't clone (no cloning endpoint is proxied) -- preset slug only. Local route
  // clones from a selected profile clip, or uses a worker preset when none is chosen.
  function currentVoice(): VoiceSelection | null {
    if (route === 'openrouter') {
      return cloudVoice.trim() ? { kind: 'preset', voiceId: cloudVoice.trim() } : null
    }
    const profile = profiles.find((p) => p.id === voiceId)
    if (profile) return { kind: 'profile', profile }
    if (localPreset.trim()) return { kind: 'preset', voiceId: localPreset.trim() }
    return null
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
      model: route === 'openrouter' && model.trim() ? model.trim() : undefined,
      usePlaceholder,
    })
    const variant = voice.kind === 'profile' ? `clone:${voice.profile.name}` : `preset:${voice.voiceId}`
    onRun({
      id: crypto.randomUUID(),
      medium: 'tts',
      route,
      model:
        route === 'local'
          ? worker.status === 'online'
            ? worker.capabilities.ttsBackend ?? 'worker'
            : 'worker'
          : model.trim() || ttsModelDefault,
      variant,
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

  return (
    <div className="flex flex-col gap-4">
      <RouteControls
        route={route}
        onRouteChange={setRoute}
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

      {route === 'openrouter' ? (
        <div className="flex flex-col gap-1">
          <label htmlFor="tts-cloud-voice" className="text-xs text-muted-foreground">
            Preset voice (OpenRouter has no cloning - pick a Voxtral preset)
          </label>
          <input
            id="tts-cloud-voice"
            list="voxtral-voices"
            value={cloudVoice}
            onChange={(e) => setCloudVoice(e.target.value)}
            className="h-9 w-72 rounded-md border bg-background px-2 font-mono text-xs"
          />
          <datalist id="voxtral-voices">
            {VOXTRAL_VOICES.map((voice) => (
              <option key={voice.slug} value={voice.slug}>
                {voice.label}
              </option>
            ))}
          </datalist>
          <p className="text-xs text-muted-foreground">
            More presets exist in Mistral Studio; type any valid slug. To clone a voice, switch to
            the local route.
          </p>
        </div>
      ) : (
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="tts-voice" className="text-xs text-muted-foreground">
              Voice profile (clone{canCloneLocal ? '' : ' - worker has no cloning, will use preset'})
            </label>
            <select
              id="tts-voice"
              value={voiceId ?? ''}
              onChange={(e) => {
                setVoiceId(e.target.value || null)
                if (e.target.value) setLocalPreset('')
              }}
              className="h-9 w-56 rounded-md border bg-background px-2 text-sm"
            >
              <option value="">None</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="tts-preset-voice" className="text-xs text-muted-foreground">
              or preset voice id
            </label>
            <input
              id="tts-preset-voice"
              list="tts-worker-voices"
              value={localPreset}
              onChange={(e) => {
                setLocalPreset(e.target.value)
                if (e.target.value) setVoiceId(null)
              }}
              placeholder={workerVoices[0] ?? 'am_michael'}
              className="h-9 w-56 rounded-md border bg-background px-2 font-mono text-xs"
            />
            <datalist id="tts-worker-voices">
              {workerVoices.map((voice) => (
                <option key={voice} value={voice} />
              ))}
            </datalist>
          </div>

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
