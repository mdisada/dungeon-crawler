import { Loader2, Play } from 'lucide-react'
import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { useVoiceProfiles, useVoiceSample, VOICE_SAMPLE_COUNT } from '@/features/tts'

interface VoicePickerProps {
  label: string
  selectedVoiceId: string | null
  onSelect: (voiceProfileId: string | null) => Promise<void>
}

// F04 SS5.1/SS5.2: pick from the user's voice_profiles collection (plus the built-in voices every
// account can read) or upload a clip. Clip storage and synthesis both live in features/tts, so
// this component only picks, uploads, and auditions.
export function VoicePicker({ label, selectedVoiceId, onSelect }: VoicePickerProps) {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  const { profiles, error, upload } = useVoiceProfiles(userId)
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const sample = useVoiceSample(userId, selectedVoiceId)

  async function handleUpload(file: File) {
    setIsBusy(true)
    setStatus(null)
    const name = file.name.replace(/\.[^.]+$/, '')
    const profile = await upload(name, file)
    if (profile) {
      await onSelect(profile.id)
      setStatus(`Uploaded "${name}"`)
    }
    setIsBusy(false)
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm" htmlFor={`voice-${label}`}>
        {label}
        <span className="flex items-center gap-2">
          <select
            id={`voice-${label}`}
            className="h-9 w-full min-w-0 max-w-xs rounded-md border bg-background px-2 text-sm"
            value={selectedVoiceId ?? ''}
            onChange={(e) => {
              void onSelect(e.target.value === '' ? null : e.target.value).then(() => setStatus(null))
            }}
          >
            <option value="">No voice selected</option>
            {profiles.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          {/* Beside the voice rather than under it: auditioning is part of choosing, and the
              first press synthesizes all three lines at once so every later press is instant. */}
          <button
            type="button"
            disabled={!selectedVoiceId || sample.isLoading}
            onClick={sample.play}
            aria-label={`Hear this voice, sample ${sample.nextIndex} of ${VOICE_SAMPLE_COUNT}`}
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-md border text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40 disabled:hover:bg-transparent"
          >
            {sample.isLoading ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Play className="size-4" />
            )}
          </button>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>
          Upload clip (3s+, cropped to 15s)
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/*"
          className="hidden"
          aria-label={`Upload ${label} clip`}
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleUpload(file)
            e.target.value = ''
          }}
        />
      </div>
      {(status ?? error ?? sample.error) && (
        <p className="text-xs text-muted-foreground">{status ?? error ?? sample.error}</p>
      )}
    </div>
  )
}
