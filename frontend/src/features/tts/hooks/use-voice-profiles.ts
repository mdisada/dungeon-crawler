import { useEffect, useState } from 'react'

import { deleteVoiceProfile, listVoiceProfiles, uploadVoiceProfile } from '../api/voice-profiles'
import type { VoiceProfile } from '../types'

export function useVoiceProfiles(userId: string | null) {
  const [profiles, setProfiles] = useState<VoiceProfile[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    listVoiceProfiles()
      .then((rows) => {
        if (!cancelled) setProfiles(rows)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load voice profiles')
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const upload = async (name: string, file: File): Promise<VoiceProfile | null> => {
    if (!userId) return null
    setError(null)
    try {
      const profile = await uploadVoiceProfile(userId, name, file)
      setProfiles((prev) => [profile, ...prev])
      return profile
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload that clip')
      return null
    }
  }

  const remove = async (profile: VoiceProfile) => {
    setError(null)
    try {
      await deleteVoiceProfile(profile)
      setProfiles((prev) => prev.filter((p) => p.id !== profile.id))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete that voice')
    }
  }

  return { profiles, isLoading, error, upload, remove }
}
