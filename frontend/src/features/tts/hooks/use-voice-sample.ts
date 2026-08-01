import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { VOICE_SAMPLE_LINES } from '../voice-samples'
import type { VoiceSampleKind } from '../voice-samples'
import { useNarrationAudio } from './use-narration-audio'

/** Short lines; if one has not landed in this long, something is wrong rather than slow. */
const SAMPLE_DEADLINE_MS = 10_000

export interface VoiceSample {
  /** Auditions the voice, cycling to the next line each press. */
  play: () => void
  /** Waiting on synthesis for the line just requested. */
  isLoading: boolean
  /** Which line the next press will play, 1-based, for the control's label. */
  nextIndex: number
  /** How many lines this role auditions with, for the control's label. */
  total: number
  error: string | null
}

/**
 * Auditions a voice profile on a short fixed line, cycling through VOICE_SAMPLE_LINES.
 *
 * All three lines are requested together on the first press, so the wait is paid once: the first
 * press synthesizes (~1s for a line this short) and every press after it - including for lines
 * two and three, and including on a later visit - is a cache hit and plays immediately.
 *
 * Nothing is requested until the user actually presses play. Auditioning on selection would spend
 * credit every time someone opened a dropdown.
 */
export function useVoiceSample(
  userId: string | null,
  voiceProfileId: string | null,
  kind: VoiceSampleKind,
): VoiceSample {
  // `nonce` distinguishes two presses of the same line, so replaying works.
  const [request, setRequest] = useState<{ index: number; nonce: number } | null>(null)
  const playedRef = useRef(-1)

  const lines = useMemo(() => [...VOICE_SAMPLE_LINES[kind]], [kind])

  const audio = useNarrationAudio({
    // Requesting only once armed: the hook fires as soon as it has a line and chunks.
    scope: request && userId ? `lab-${userId}` : null,
    adventureId: null,
    // Keyed by voice AND role, not by press: cycling to line two reuses the same in-flight
    // request, while a narrator picker and an NPC picker on one screen stay off each other's
    // broadcasts.
    lineId: voiceProfileId ? `voice-sample-${kind}-${voiceProfileId}` : null,
    chunks: lines,
    enabled: request !== null && voiceProfileId !== null,
    deadlineMs: SAMPLE_DEADLINE_MS,
    // No box to hold - the caller wants the clip, not a paced reveal.
    holdFirstBox: false,
    voiceProfileId,
    volume: 1,
  })

  const chunk = request ? audio.state.chunks[request.index] : undefined

  // Plays as soon as the requested line settles. A ref rather than state so this never writes
  // state from an effect; `isLoading` is derived from the audio state instead, which re-renders
  // on its own.
  useEffect(() => {
    if (!request || playedRef.current === request.nonce) return
    if (!chunk || chunk.status === 'pending') return
    playedRef.current = request.nonce
    if (chunk.status === 'ready') audio.play(request.index)
  }, [request, chunk, audio])

  const play = useCallback(() => {
    setRequest((prev) => ({
      index: prev === null ? 0 : (prev.index + 1) % lines.length,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [lines.length])

  const failed = chunk !== undefined && chunk.status !== 'pending' && chunk.status !== 'ready'
  return {
    play,
    // Derived from the audio state rather than from playedRef: a ref read during render does not
    // re-render when it changes, and this drives a spinner.
    isLoading: request !== null && (chunk === undefined || chunk.status === 'pending'),
    nextIndex: request === null ? 1 : ((request.index + 1) % lines.length) + 1,
    total: lines.length,
    error: audio.state.error ?? (failed ? (chunk?.error ?? 'That voice could not be synthesized') : null),
  }
}
