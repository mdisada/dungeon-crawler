import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useNarrationAudio } from './use-narration-audio'

/** Short lines; if one has not landed in this long, something is wrong rather than slow. */
const SAMPLE_DEADLINE_MS = 10_000

export interface VoiceSample {
  /** Auditions the voice, cycling to the next line each press. */
  play: () => void
  /** Waiting - on the lines being written, or on the clip being synthesized. */
  isLoading: boolean
  /** Which line the next press will play, 1-based, for the control's label. */
  nextIndex: number
  /** How many lines this audition has, for the control's label. */
  total: number
  error: string | null
}

interface UseVoiceSampleOptions {
  userId: string | null
  voiceProfileId: string | null
  /**
   * What the voice says. Null means "not written yet": the press is remembered and plays as soon
   * as lines arrive, so a caller generating them lazily needs no sequencing of its own.
   */
  lines: readonly string[] | null
  /**
   * Identifies this audition on the narration broadcast channel. Must differ per line set, or two
   * pickers open at once - the narrator's and an NPC's, or two NPCs sharing a voice - would match
   * each other's messages and play the wrong clip.
   */
  sampleKey: string
  /** Called on the first press when `lines` is null, to go and write them. */
  onNeedLines?: () => void
}

/**
 * Auditions a voice on a short line, cycling through the set.
 *
 * All the lines are requested together on the first press, so the wait is paid once: the first
 * press synthesizes (~1s for a line this short) and every press after it - including for the later
 * lines, and including on a return visit - is a cache hit and plays immediately.
 *
 * Nothing is requested until the user presses play. Auditioning on selection would spend credit
 * every time someone opened a dropdown.
 */
export function useVoiceSample({
  userId,
  voiceProfileId,
  lines,
  sampleKey,
  onNeedLines,
}: UseVoiceSampleOptions): VoiceSample {
  // `nonce` distinguishes two presses of the same line, so replaying works.
  const [request, setRequest] = useState<{ index: number; nonce: number } | null>(null)
  const playedRef = useRef(-1)

  const chunks = useMemo(() => (lines ? [...lines] : []), [lines])
  const total = chunks.length

  const audio = useNarrationAudio({
    // Requesting only once armed: the hook fires as soon as it has a line and chunks.
    scope: request && userId ? `lab-${userId}` : null,
    adventureId: null,
    lineId: voiceProfileId ? `voice-sample-${sampleKey}-${voiceProfileId}` : null,
    chunks,
    enabled: request !== null && voiceProfileId !== null && total > 0,
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
    if (lines === null) onNeedLines?.()
    setRequest((prev) => ({
      // Cycles within whatever set finally arrives; a first press while lines are still being
      // written is line one either way.
      index: prev === null || total === 0 ? 0 : (prev.index + 1) % total,
      nonce: (prev?.nonce ?? 0) + 1,
    }))
  }, [lines, onNeedLines, total])

  const failed = chunk !== undefined && chunk.status !== 'pending' && chunk.status !== 'ready'
  return {
    play,
    // Derived from the audio state rather than from playedRef: a ref read during render does not
    // re-render when it changes, and this drives a spinner.
    isLoading: request !== null && (lines === null || chunk === undefined || chunk.status === 'pending'),
    nextIndex: request === null || total === 0 ? 1 : ((request.index + 1) % total) + 1,
    total: Math.max(total, 1),
    error: audio.state.error ?? (failed ? (chunk?.error ?? 'That voice could not be synthesized') : null),
  }
}
