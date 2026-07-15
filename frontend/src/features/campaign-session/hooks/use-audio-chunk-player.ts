import { useCallback, useRef } from 'react'
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
  const audioElRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<AudioChunk[]>([])
  const isPlayingRef = useRef(false)
  const hasPlayedFirstRef = useRef(false)
  // The pause before a chunk is a setTimeout, not an immediate play — reset() must be able to
  // cancel it, otherwise a reset mid-pause (e.g. a fresh generation starting) doesn't stop the
  // previous, now-superseded chunk from playing once the timeout fires anyway.
  const pauseTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const playNext = useCallback(() => {
    const audio = audioElRef.current
    const next = queueRef.current.shift()
    if (!audio || !next) {
      isPlayingRef.current = false
      return
    }
    isPlayingRef.current = true

    const start = () => {
      pauseTimeoutRef.current = null
      audio.src = next.url
      audio.play().catch(() => {
        isPlayingRef.current = false
      })
    }

    if (!hasPlayedFirstRef.current) {
      hasPlayedFirstRef.current = true
      start()
    } else {
      pauseTimeoutRef.current = setTimeout(start, next.isNewParagraph ? LONG_PAUSE_MS : SHORT_PAUSE_MS)
    }
  }, [])

  // A callback ref rather than a plain useRef: the <audio> element isn't always mounted on the
  // very first render (e.g. it's behind a loading gate in the consuming component), and a plain
  // ref's attachment doesn't retrigger effects — a useEffect that attaches the 'ended' listener
  // could run once while the ref is still null and then never run again. A callback ref instead
  // fires exactly when the node mounts/unmounts, whenever that happens.
  const audioRef = useCallback(
    (node: HTMLAudioElement | null) => {
      audioElRef.current?.removeEventListener('ended', playNext)
      audioElRef.current = node
      node?.addEventListener('ended', playNext)
    },
    [playNext],
  )

  const enqueue = useCallback(
    (chunk: AudioChunk) => {
      queueRef.current.push(chunk)
      if (!isPlayingRef.current) playNext()
    },
    [playNext],
  )

  const reset = useCallback(() => {
    if (pauseTimeoutRef.current !== null) {
      clearTimeout(pauseTimeoutRef.current)
      pauseTimeoutRef.current = null
    }
    queueRef.current = []
    isPlayingRef.current = false
    hasPlayedFirstRef.current = false
    audioElRef.current?.pause()
    audioElRef.current?.removeAttribute('src')
  }, [])

  return { audioRef, enqueue, reset }
}
