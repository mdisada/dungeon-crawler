import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useNarrationAudio } from '@/features/tts'
import type { DialogueLine } from '@rules/state'

import { settledBoxCount, splitNarration } from '../sentences'
import { useLineReveal } from './use-line-reveal'
import type { LineReveal } from './use-line-reveal'

/**
 * How long the story will wait on a chunk before giving up on its audio and revealing silently.
 *
 * 15s, from measurement rather than taste (2026-08-01): a 195-char box - an ordinary one - is
 * playable ~7.2s after the request on s2.1-pro. This is a ceiling that should almost never be
 * reached, not a target; the deadline exists so a dead chunk can never stall the story.
 */
const NARRATION_DEADLINE_MS = 15_000

export interface NarrationDelivery extends LineReveal {
  /** Autoplay was blocked - surfaced through the header's existing audio-unlock affordance. */
  needsAudioUnlock: boolean
  unlockAudio: () => void
}

interface UseNarrationOptions {
  adventureId: string
  /** The line the box would deliver if audio were not a consideration. */
  next: DialogueLine | null
  narrationVolume: number
  isMuted: boolean
}

/**
 * Narration delivery: the player-paced reveal, with each beat gated on its audio being ready.
 *
 * Two gates, from the F12 design interview:
 *   - a new line is HELD - the previous beat stays on screen - until its first clip is playable,
 *     so the narrator's voice and their words land on the same frame;
 *   - the advance chevron appears only once the NEXT chunk is playable.
 *
 * Both fail open. An adventure with no narrator voice, a muted player, a failed synthesis or one
 * that overruns the deadline all resolve to "settled", so the story can never be stalled by audio -
 * it just plays silently. That is what makes this safe to put in front of the story pipeline.
 */
export function useNarration({
  adventureId,
  next,
  narrationVolume,
  isMuted,
}: UseNarrationOptions): NarrationDelivery {
  // `lead` splits only the first box into sentences, so the story starts speaking on a ~1s clip
  // instead of waiting ~4.6s for the whole box. Later boxes stay whole and keep their prosody.
  const split = useMemo(() => splitNarration(next?.text ?? ''), [next])

  const audio = useNarrationAudio({
    scope: adventureId,
    adventureId,
    lineId: next?.id ?? null,
    npcId: next?.npcId ?? null,
    chunks: split.units,
    // Muted costs nothing and waits for nothing: this client never even asks for synthesis.
    enabled: !isMuted && narrationVolume > 0,
    deadlineMs: NARRATION_DEADLINE_MS,
    holdFirstBox: true,
    volume: narrationVolume,
  })

  // The line actually on screen. Swapping only once the incoming line's first clip is playable is
  // what "hold" means. Adjusted during render rather than in an effect (react.dev, "adjusting
  // state when props change") - same pattern useLineReveal uses to reset on a line change.
  const [held, setHeld] = useState<DialogueLine | null>(null)
  const nextId = next?.id ?? null
  const heldId = held?.id ?? null
  // A null line clears immediately: the server clears activeLineId deliberately (staging a social
  // scene, ending a session) and a stale line must not linger behind an audio gate.
  if (heldId !== nextId && (audio.canReveal || next === null)) setHeld(next)

  const isHolding = heldId !== nextId
  const reveal = useLineReveal(held)

  // While holding, the chevron answers to the line on screen, not to the one being synthesized.
  // The previous line's own chunks were gated when it was live, and the input row blocks the
  // player from acting until they have caught up - so by the time a new line arrives they have
  // effectively finished this one. Ungating here costs at most a free click through a beat they
  // have already heard, and it is the alternative to freezing the old line behind the new line's
  // audio, which would read as a hang.
  //
  // Box-level, not unit-level: a box with three sentences is only safe to advance to once all
  // three have settled, or the chevron would offer a box that runs out of audio halfway through.
  // The first box is the deliberate exception - `audio.canReveal` opens it on its first sentence,
  // with the rest queued behind and synthesis running well ahead of the reading.
  const playableBoxes = settledBoxCount(split.unitsFor, audio.settled)
  const canAdvance = reveal.isRevealing && (isHolding || playableBoxes >= reveal.visibleCount + 1)

  const advance = useCallback(() => {
    if (canAdvance) reveal.advance()
  }, [canAdvance, reveal])

  // Playback follows whatever chunk is on screen. Keyed by line + index so a re-render cannot
  // restart a clip, and so returning to chunk 0 of a NEW line still plays.
  const playedRef = useRef<string | null>(null)
  useEffect(() => {
    if (isHolding || reveal.visibleCount === 0 || heldId === null) return
    const index = reveal.visibleCount - 1
    const key = `${heldId}:${index}`
    if (playedRef.current === key) return
    playedRef.current = key
    // A box can map to several clips under `lead`, so playback is a queue, not a single file.
    audio.playSequence(split.unitsFor[index] ?? [])
  }, [isHolding, heldId, reveal.visibleCount, split.unitsFor, audio])

  return useMemo(
    () => ({
      ...reveal,
      canAdvance,
      advance,
      needsAudioUnlock: audio.needsUnlock,
      unlockAudio: audio.unlock,
    }),
    [reveal, canAdvance, advance, audio.needsUnlock, audio.unlock],
  )
}
