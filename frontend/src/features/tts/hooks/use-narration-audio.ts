import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react'

import { supabase } from '@/lib/supabase'
import { requestNarration } from '../api/narrate'
import { initialNarrationState, narrationReducer, playableUrl, settledCount } from '../narration-state'
import type { NarrationState } from '../narration-state'
import type { NarrationAudio, UseNarrationAudioArgs } from '../types'

/** One catch-up request at half the deadline recovers a broadcast missed during a reconnect. */
const CATCH_UP_FRACTION = 0.5

export function useNarrationAudio({
  scope,
  adventureId,
  lineId,
  npcId = null,
  chunks,
  enabled,
  deadlineMs,
  holdFirstBox,
  maxInFlight,
  model,
  voiceProfileId = null,
  force = false,
  volume,
}: UseNarrationAudioArgs): NarrationAudio {
  const [state, dispatch] = useReducer(narrationReducer, initialNarrationState)
  const [needsUnlock, setNeedsUnlock] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const queueRef = useRef<number[]>([])
  // True when the queue is parked on a chunk that is still being synthesized - see `step`.
  const waitingRef = useRef(false)
  const startedAtRef = useRef(0)
  // `play` must stay stable for callers that hand it to memoized children, so it reads the latest
  // state through a ref rather than closing over it. Mirrored in an effect, not during render:
  // playback is only ever started from an event handler or a later effect, both of which run after
  // this one has committed the current state. That effect is also where a parked queue resumes,
  // so it lives below `step`.
  const stateRef = useRef<NarrationState>(state)

  // The chunk texts identify a request, but the array's identity changes every render. Round-trip
  // through JSON so the effect re-runs on a content change and only on a content change.
  const signature = JSON.stringify(chunks)
  const texts = useMemo(() => JSON.parse(signature) as string[], [signature])
  const isActive = enabled && scope !== null && lineId !== null && texts.length > 0

  useEffect(() => {
    const audio = new Audio()
    audioRef.current = audio
    return () => {
      audio.pause()
      audio.src = ''
      audioRef.current = null
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = Math.min(1, Math.max(0, volume))
  }, [volume])

  useEffect(() => {
    if (!enabled || scope === null || lineId === null || texts.length === 0) {
      dispatch({ type: 'reset' })
      return
    }

    const startedAt = performance.now()
    startedAtRef.current = startedAt
    dispatch({ type: 'start', lineId, count: texts.length })

    let cancelled = false
    const since = () => performance.now() - startedAt

    const send = async (isCatchUp: boolean) => {
      const plan = await requestNarration({
        adventureId,
        lineId,
        npcId,
        chunks: texts,
        model,
        voiceProfileId,
        maxInFlight,
        // NEVER on the catch-up. `force` busts the cache server-side, and firing it mid-run would
        // delete the very clips and reservations the first request is still producing - including
        // storage objects already uploaded, whose signed URLs would then 404 on playback.
        force: force && !isCatchUp,
      })
      if (cancelled) return
      if (plan.silent) {
        dispatch({ type: 'silent' })
        return
      }
      dispatch({ type: 'planned', chunks: plan.chunks, timings: plan.timings, atMs: since() })
    }

    // Subscribed before the request goes out: a chunk can be synthesized and broadcast faster than
    // the response comes back, and a listener attached afterwards would miss it.
    const channel = supabase.channel(`narration:${scope}`, { config: { private: true } })
    channel
      .on('broadcast', { event: 'chunk_ready' }, ({ payload }) => {
        const message = payload as { line_id: string; index: number; url: string | null; ms?: number }
        if (cancelled || message.line_id !== lineId || !message.url) return
        dispatch({
          type: 'ready',
          index: message.index,
          url: message.url,
          atMs: since(),
          serverMs: message.ms ?? null,
        })
      })
      .on('broadcast', { event: 'chunk_failed' }, ({ payload }) => {
        const message = payload as { line_id: string; index: number; error?: string }
        if (cancelled || message.line_id !== lineId) return
        dispatch({ type: 'failed', index: message.index, error: message.error ?? 'synthesis failed', atMs: since() })
      })
      .subscribe((status) => {
        if (cancelled || status !== 'SUBSCRIBED') return
        void send(false).catch((err) => {
          if (!cancelled) {
            dispatch({ type: 'error', message: err instanceof Error ? err.message : 'narration failed' })
          }
        })
      })

    // A single re-request partway through the first wait. The server-side claim makes it nearly
    // free - already-synthesized chunks come back with URLs in the response body - and it is what
    // lets a client that reconnected mid-line catch up instead of sitting on a silent box.
    const catchUp = setTimeout(() => {
      if (!cancelled) void send(true).catch(() => undefined)
    }, Math.max(500, deadlineMs * CATCH_UP_FRACTION))

    return () => {
      cancelled = true
      clearTimeout(catchUp)
      void supabase.removeChannel(channel)
    }
    // deadlineMs only seeds the catch-up delay; re-running this effect when the lab's slider moves
    // would restart synthesis mid-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, scope, adventureId, lineId, npcId, texts, model, voiceProfileId, maxInFlight, force])

  const settled = isActive ? settledCount(state) : Number.MAX_SAFE_INTEGER

  // The deadline is armed for the NEXT unsettled chunk only, and re-arms as each one settles, so
  // it measures how long a player is actually waiting rather than how long the whole line took. A
  // late chunk is released silently; audio that arrives after that is discarded rather than played
  // under the wrong box (see `settle` in narration-state).
  useEffect(() => {
    if (!isActive || state.phase === 'silent' || state.phase === 'error') return
    if (settled >= state.chunks.length) return
    const index = settled
    const timer = setTimeout(
      () => dispatch({ type: 'timeout', index, atMs: performance.now() - startedAtRef.current }),
      deadlineMs,
    )
    return () => clearTimeout(timer)
  }, [isActive, settled, state.phase, state.chunks.length, deadlineMs])

  // One box can map to more than one clip when synthesis is per sentence, so playback is a queue.
  // In the default per-box mode every queue has exactly one entry.
  const step = useCallback(function step() {
    const audio = audioRef.current
    if (!audio) return
    const next = queueRef.current[0]
    if (next === undefined) {
      audio.onended = null
      waitingRef.current = false
      return
    }
    // Still being synthesized: PARK, do not drop it. Under `lead` the first box is several
    // sentences and is revealed on the first one, so the rest are routinely still in flight when
    // that clip ends - skipping them made the narrator fall silent mid-paragraph at session start,
    // which is exactly where the split was introduced to help. Resumed by the effect below. The
    // per-chunk deadline guarantees it ends: a chunk that never arrives settles as `timeout` and
    // is skipped by the check under this one.
    if (stateRef.current.chunks[next]?.status === 'pending') {
      waitingRef.current = true
      return
    }
    queueRef.current.shift()
    waitingRef.current = false
    const url = playableUrl(stateRef.current, next)
    // A settled-but-unplayable chunk (failed or timed out) is skipped - the rest of the box still
    // reads aloud.
    if (!url) {
      step()
      return
    }
    audio.src = url
    audio.currentTime = 0
    audio.onended = step
    audio.play().then(
      () => setNeedsUnlock(false),
      () => setNeedsUnlock(true),
    )
  }, [])

  useEffect(() => {
    stateRef.current = state
    if (waitingRef.current) step()
  }, [state, step])

  const playSequence = useCallback(
    (indices: number[]) => {
      const audio = audioRef.current
      if (!audio) return
      queueRef.current = [...indices]
      waitingRef.current = false
      audio.pause()
      step()
    },
    [step],
  )

  const play = useCallback((index: number) => playSequence([index]), [playSequence])

  const stop = useCallback(() => {
    queueRef.current = []
    waitingRef.current = false
    const audio = audioRef.current
    if (!audio) return
    audio.onended = null
    audio.pause()
  }, [])

  const unlock = useCallback(() => {
    audioRef.current?.play().then(
      () => setNeedsUnlock(false),
      () => setNeedsUnlock(true),
    )
  }, [])

  return useMemo(
    () => ({
      state,
      settled,
      // Holding is what makes text and voice land on the same frame. Turned off, the box renders
      // the instant the text exists and the voice catches up.
      canReveal: !isActive || !holdFirstBox || settled >= 1,
      canAdvance: (visibleCount: number) => settled >= visibleCount + 1,
      play,
      playSequence,
      stop,
      needsUnlock,
      unlock,
    }),
    [state, settled, isActive, holdFirstBox, play, playSequence, stop, needsUnlock, unlock],
  )
}
