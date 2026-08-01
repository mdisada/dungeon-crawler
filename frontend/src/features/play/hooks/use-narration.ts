import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { requestNarration, useNarrationAudio, warmNarrationVoice } from '@/features/tts'
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
  /** Everything the box still owes the player, oldest first, ending at the active line. */
  queue: DialogueLine[]
  narrationVolume: number
  isMuted: boolean
}

/**
 * Narration delivery: the player-paced reveal, with each beat gated on its audio being ready.
 *
 * Three rules. The first is the queue cursor (2026-08-01): the box delivers the oldest line the
 * player has not read, so a line staged while they are still reading lands BEHIND them instead of
 * taking the box. The other two are the F12 audio gates:
 *   - a new line is HELD - the previous beat stays on screen - until its first clip is playable,
 *     so the narrator's voice and their words land on the same frame;
 *   - the advance chevron appears only once the NEXT chunk is playable.
 *
 * The gates fail open. An adventure with no narrator voice, a muted player, a failed synthesis or
 * one that overruns the deadline all resolve to "settled", so the story can never be stalled by
 * audio - it just plays silently. That is what makes this safe to put in front of the story
 * pipeline. Nothing here writes state or reorders it: the queue is the server's own line order,
 * read at the player's pace.
 */
export function useNarration({
  adventureId,
  queue,
  narrationVolume,
  isMuted,
}: UseNarrationOptions): NarrationDelivery {
  // Where the player has got to. Held by id rather than index so an append cannot shift it.
  const [currentId, setCurrentId] = useState<string | null>(null)
  const index = queue.findIndex((line) => line.id === currentId)
  // No cursor to honour - the first line of a session, a box the server cleared, or history
  // evicted from under the player - so take the newest rather than replaying a backlog they never
  // saw. At session start that IS the recap: the intros the same write staged sit after
  // activeLineId, so they only enter the queue once the server moves it past them.
  const next = index >= 0 ? queue[index] : (queue[queue.length - 1] ?? null)
  if ((next?.id ?? null) !== currentId) setCurrentId(next?.id ?? null)

  // `lead` splits only the first box into sentences, so the story starts speaking on a ~1s clip
  // instead of waiting ~4.6s for the whole box. Later boxes stay whole and keep their prosody.
  const split = useMemo(() => splitNarration(next?.text ?? ''), [next])

  // Muted costs nothing and waits for nothing: this client never even asks for synthesis.
  const isAudioEnabled = !isMuted && narrationVolume > 0

  // Register the narrator's voice with Fish before there is a line to speak. A built-in voice
  // carries no reference_id until something uses it, and that registration is ~9s - which the
  // session's FIRST line would otherwise pay in full, in front of the player. Here it runs while
  // the table is still in the lobby. Best-effort: the line's own request resolves the voice anyway.
  useEffect(() => {
    if (!isAudioEnabled) return
    void warmNarrationVoice(adventureId).catch(() => undefined)
  }, [isAudioEnabled, adventureId])

  const audio = useNarrationAudio({
    scope: adventureId,
    adventureId,
    lineId: next?.id ?? null,
    npcId: next?.npcId ?? null,
    chunks: split.units,
    enabled: isAudioEnabled,
    deadlineMs: NARRATION_DEADLINE_MS,
    holdFirstBox: true,
    volume: narrationVolume,
  })

  // Synthesis for the line AFTER this one, started while this one is still being read.
  //
  // The cursor costs what pointing at the newest line got for free: a line used to become `next`
  // the moment it landed, so Fish was already working while the player finished the previous beat.
  // Read in queue order, nothing would be asked for until they arrive - a fresh first-clip wait
  // (~2.4s measured) at every line boundary, and session start queues several lines in a row.
  //
  // Safe to fire from every client at the table: `claim_narration_clip` makes exactly one of them
  // the synthesizer, and by the time the cursor arrives `planChunks` answers `cached` with URLs in
  // the response body, so the real request never waits on Fish at all. One line ahead only, at one
  // clip in flight, so the line being READ keeps the concurrency budget (Fish Starter allows 5
  // account-wide and narration already runs 3). Nothing is wasted: every queued line gets read.
  const following = index >= 0 ? queue[index + 1] : undefined
  const prefetchedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!isAudioEnabled || !following || prefetchedRef.current === following.id) return
    prefetchedRef.current = following.id
    void requestNarration({
      adventureId,
      lineId: following.id,
      npcId: following.npcId ?? null,
      chunks: splitNarration(following.text).units,
      maxInFlight: 1,
      // Best-effort: the request the cursor makes on arrival is the one that has to work.
    }).catch(() => undefined)
  }, [isAudioEnabled, following, adventureId])

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

  // Box-level, not unit-level: a box with three sentences is only safe to advance to once all
  // three have settled, or the chevron would offer a box that runs out of audio halfway through.
  // The first box is the deliberate exception - `audio.canReveal` opens it on its first sentence,
  // with the rest queued behind and synthesis running well ahead of the reading.
  const playableBoxes = settledBoxCount(split.unitsFor, audio.settled)
  const hasNextLine = following !== undefined
  // Nothing is offered while holding: the player has finished the line on screen (that is the only
  // way the cursor moves), so the chevron would advance a beat that is not there yet.
  const canAdvance = !isHolding && (reveal.isRevealing ? playableBoxes >= reveal.visibleCount + 1 : hasNextLine)

  // "The player has not caught up" now spans the whole queue, not just the line on screen - which
  // is what keeps the input row shut over a backlog and stops "the DM is thinking" from appearing
  // over unread story.
  const isRevealing = reveal.isRevealing || hasNextLine || isHolding

  const advance = useCallback(() => {
    if (!canAdvance) return
    if (reveal.isRevealing) {
      reveal.advance()
      return
    }
    if (following) setCurrentId(following.id)
  }, [canAdvance, reveal, following])

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
      isRevealing,
      canAdvance,
      advance,
      needsAudioUnlock: audio.needsUnlock,
      unlockAudio: audio.unlock,
    }),
    [reveal, isRevealing, canAdvance, advance, audio.needsUnlock, audio.unlock],
  )
}
