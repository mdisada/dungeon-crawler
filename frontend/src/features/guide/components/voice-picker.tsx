import { useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { previewVoice, useVoiceProfiles } from '@/features/tts'

interface VoicePickerProps {
  label: string
  selectedVoiceId: string | null
  onSelect: (voiceProfileId: string | null) => Promise<void>
}

// F04 SS5.1/SS5.2: pick from the user's voice_profiles collection or upload a clip; the preview
// button synthesizes a fixed sample line. Clip storage and synthesis both live in features/tts
// now, so this component only picks and assigns.
export function VoicePicker({ label, selectedVoiceId, onSelect }: VoicePickerProps) {
  const { session } = useSession()
  const userId = session?.user.id ?? null
  const { profiles, error, upload } = useVoiceProfiles(userId)
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

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

  async function handlePreview() {
    const profile = profiles.find((p) => p.id === selectedVoiceId)
    if (!profile || !userId) return
    setIsBusy(true)
    setStatus(null)
    try {
      const { url, cloned, reason } = await previewVoice(userId, profile)
      audioRef.current?.pause()
      audioRef.current = new Audio(url)
      await audioRef.current.play()
      if (!cloned) setStatus(`Playing your uploaded clip - synthesis failed: ${reason ?? 'unknown'}`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Preview failed')
    } finally {
      setIsBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1 text-sm">
        {label}
        <select
          aria-label={label}
          className="h-9 w-full max-w-xs rounded-md border bg-background px-2 text-sm"
          value={selectedVoiceId ?? ''}
          onChange={(e) => {
            void onSelect(e.target.value === '' ? null : e.target.value).then(() =>
              setStatus(null),
            )
          }}
        >
          <option value="">No voice selected</option>
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" disabled={isBusy} onClick={() => fileInputRef.current?.click()}>
          Upload clip (3s+, cropped to 15s)
        </Button>
        <Button variant="outline" size="sm" disabled={isBusy || !selectedVoiceId} onClick={() => void handlePreview()}>
          Preview
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
      {(status ?? error) && <p className="text-xs text-muted-foreground">{status ?? error}</p>}
    </div>
  )
}
