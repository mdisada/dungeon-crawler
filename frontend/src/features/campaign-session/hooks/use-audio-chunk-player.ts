import { useCallback, useEffect, useRef } from 'react'
import type { AudioChunk } from '../types'

// Gap between consecutive sentences, and the longer gap at a paragraph boundary — keeps
// sentence-by-sentence playback from sounding like it's being read one clip at a time.
const SHORT_PAUSE_MS = 250
const LONG_PAUSE_MS = 600

/** A sequential audio-chunk player: chunks pushed via `enqueue` play in order, each preceded by a
 * natural pause (longer at paragraph boundaries), never interrupting whatever's currently
 * playing. Shared by the live narration hook (chunks arrive one at a time as they're generated)
 * and the turn-history replay button (the full chunk list is already known up front).
 */
export function useAudioChunkPlayer() {
  const audioRef = useRef<HTMLAudioElement>(null)
  const queueRef = useRef<AudioChunk[]>([])
  const isPlayingRef = useRef(false)
  const hasPlayedFirstRef = useRef(false)

  const playNext = useCallback(() => {
    const audio = audioRef.current
    const next = queueRef.current.shift()
    if (!audio || !next) {
      isPlayingRef.current = false
      return
    }
    isPlayingRef.current = true

    const start = () => {
      audio.src = next.url
      audio.play().catch(() => {
        isPlayingRef.current = false
      })
    }

    if (!hasPlayedFirstRef.current) {
      hasPlayedFirstRef.current = true
      start()
    } else {
      setTimeout(start, next.isNewParagraph ? LONG_PAUSE_MS : SHORT_PAUSE_MS)
    }
  }, [])

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return
    audio.addEventListener('ended', playNext)
    return () => audio.removeEventListener('ended', playNext)
  }, [playNext])

  const enqueue = useCallback(
    (chunk: AudioChunk) => {
      queueRef.current.push(chunk)
      if (!isPlayingRef.current) playNext()
    },
    [playNext],
  )

  const reset = useCallback(() => {
    queueRef.current = []
    isPlayingRef.current = false
    hasPlayedFirstRef.current = false
    audioRef.current?.pause()
    audioRef.current?.removeAttribute('src')
  }, [])

  return { audioRef, enqueue, reset }
}
