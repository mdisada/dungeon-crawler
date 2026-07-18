import { useEffect, useRef, useState } from 'react'

import { Button } from '@/components/ui/button'
import { useSession } from '@/features/auth'
import { listVoiceProfiles, previewVoice, uploadVoiceProfile } from '../api/voices'
import type { VoiceProfile } from '../types'

interface VoicePickerProps {
  label: string
  selectedVoiceId: string | null
  onSelect: (voiceProfileId: string | null) => Promise<void>
}

// F04 SS5.1/SS5.2: pick from the user's voice_profiles collection or upload a 3-30s clip; the
// preview button synthesizes a fixed sample line (falling back to the raw clip until F12 wires
// real cloning).
export function VoicePicker({ label, selectedVoiceId, onSelect }: VoicePickerProps) {
  const { session } = useSession()
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [isBusy, setIsBusy] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  useEffect(() => {
    let cancelled = false
    listVoiceProfiles()
      .then((rows) => {
        if (!cancelled) setProfiles(rows)
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  async function handleUpload(file: File) {
    const userId = session?.user.id
    if (!userId) return
    setIsBusy(true)
    setStatus(null)
    try {
      const name = file.name.replace(/\.[^.]+$/, '')
      const profile = await uploadVoiceProfile(userId, name, file)
      setProfiles((prev) => [profile, ...prev])
      await onSelect(profile.id)
      setStatus(`Uploaded "${name}"`)
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Upload failed')
    } finally {
      setIsBusy(false)
    }
  }

  async function handlePreview() {
    const profile = profiles.find((p) => p.id === selectedVoiceId)
    if (!profile) return
    setIsBusy(true)
    setStatus(null)
    try {
      const { url, cloned } = await previewVoice(profile)
      audioRef.current?.pause()
      audioRef.current = new Audio(url)
      await audioRef.current.play()
      if (!cloned) setStatus('Cloned preview unavailable - playing your uploaded clip.')
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
          Upload clip (3-30s)
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
      {status && <p className="text-xs text-muted-foreground">{status}</p>}
    </div>
  )
}
