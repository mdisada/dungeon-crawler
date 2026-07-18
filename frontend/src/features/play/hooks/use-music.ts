import { useEffect, useRef, useState } from 'react'

import { supabase } from '@/lib/supabase'

/**
 * Plays scene.musicTrack from the music/{adventure_id}/ bucket, looped, at the given volume.
 * Autoplay may be blocked until a user gesture - needsUnlock/unlock surface that (F06 SS2
 * volume popover; the audio-unlock gesture is one of the Phase 4 user tests).
 */
export function useMusic(adventureId: string, track: string | null, volume: number) {
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [needsUnlock, setNeedsUnlock] = useState(false)

  useEffect(() => {
    const audio = new Audio()
    audio.loop = true
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    if (!track) {
      audio.pause()
      return
    }
    let cancelled = false
    void supabase.storage
      .from('music')
      .createSignedUrl(`${adventureId}/${track}`, 3600)
      .then(({ data }) => {
        if (cancelled || !data?.signedUrl || !audioRef.current) return
        audioRef.current.src = data.signedUrl
        audioRef.current.play().then(
          () => setNeedsUnlock(false),
          () => setNeedsUnlock(true),
        )
      })
    return () => {
      cancelled = true
    }
  }, [adventureId, track])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, volume))
  }, [volume])

  const unlock = () => {
    audioRef.current?.play().then(
      () => setNeedsUnlock(false),
      () => setNeedsUnlock(true),
    )
  }

  return { needsUnlock, unlock }
}
