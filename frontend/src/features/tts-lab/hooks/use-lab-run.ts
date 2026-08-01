import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { useNarrationAudio } from '@/features/tts'
import { buildChunking, settledBoxes } from '../chunking'
import type { LabChunking } from '../chunking'
import type { LabSettings } from '../types'

interface ActiveRun {
  id: number
  /** Frozen at start: changing the voice or the chunking mid-run would restart synthesis. */
  settings: LabSettings
  chunking: LabChunking
}

export interface LabRun {
  active: ActiveRun | null
  /** Boxes the player has advanced to (1-based count, mirroring useLineReveal's visibleCount). */
  visibleCount: number
  /** Leading boxes whose every clip has settled - the gate. */
  settledBoxCount: number
  canReveal: boolean
  isRevealing: boolean
  /** ms from the request starting to each box appearing, keyed by box index. */
  revealedAt: Record<number, number>
  advance: () => void
  start: (script: string, settings: LabSettings) => void
  reset: () => void
  audio: ReturnType<typeof useNarrationAudio>
}

const EMPTY_CHUNKING: LabChunking = { boxes: [], units: [], unitsFor: [] }

/**
 * One lab run: the same reveal loop play uses, driven by a pasted script instead of a session.
 *
 * Everything measurable happens here rather than in the page so the numbers come from the code
 * path being evaluated - the real hook, the real edge function, the real text box - and not from a
 * reimplementation of it that could be wrong in exactly the way we are trying to detect.
 */
export function useLabRun(userId: string, liveSettings: LabSettings): LabRun {
  const [active, setActive] = useState<ActiveRun | null>(null)
  // How many times the player has advanced. The visible box is DERIVED from this and the gate, so
  // the first box appears the moment its audio lands without an effect having to push state.
  const [advanced, setAdvanced] = useState(0)
  const [clickedAt, setClickedAt] = useState<Record<number, number>>({})
  const startedAtRef = useRef(0)
  const playedRef = useRef(-1)
  const runCounter = useRef(0)

  const chunking = active?.chunking ?? EMPTY_CHUNKING
  const frozen = active?.settings ?? liveSettings

  const audio = useNarrationAudio({
    scope: active ? `lab-${userId}` : null,
    adventureId: null,
    lineId: active ? `lab-run-${active.id}` : null,
    chunks: chunking.units,
    enabled: active !== null,
    // Live, not frozen: the point of the deadline slider is to feel its effect during a run.
    deadlineMs: liveSettings.deadlineMs,
    holdFirstBox: frozen.holdFirstBox,
    maxInFlight: frozen.maxInFlight,
    model: frozen.model,
    voiceProfileId: frozen.voiceProfileId,
    force: frozen.force,
    volume: liveSettings.volume,
  })

  const settledBoxCount = active ? settledBoxes(chunking.unitsFor, audio.settled) : 0
  const canReveal = !frozen.holdFirstBox || settledBoxCount >= 1
  const visibleCount = active && canReveal ? Math.min(advanced + 1, chunking.boxes.length) : 0
  const isRevealing = visibleCount > 0 && visibleCount < chunking.boxes.length

  // Playback follows the visible box. Not state, so no cascading render - just telling an external
  // system (the audio element) what the UI now shows.
  useEffect(() => {
    const index = visibleCount - 1
    if (index < 0 || playedRef.current === index) return
    playedRef.current = index
    audio.playSequence(chunking.unitsFor[index] ?? [])
  }, [visibleCount, chunking.unitsFor, audio])

  // Box 0's reveal time is not recorded, it is derived: with holding on, the box appears exactly
  // when its last clip settles; with holding off, the instant the run starts. Later boxes appear
  // when the player clicks, which is an event and so is recorded there.
  const revealedAt = useMemo(() => {
    if (!active) return {}
    const lastUnit = chunking.unitsFor[0]?.[chunking.unitsFor[0].length - 1] ?? 0
    const firstMs = frozen.holdFirstBox ? audio.state.chunks[lastUnit]?.settledMs : 0
    return firstMs === null || firstMs === undefined ? clickedAt : { 0: firstMs, ...clickedAt }
  }, [active, chunking.unitsFor, frozen.holdFirstBox, audio.state.chunks, clickedAt])

  const advance = useCallback(() => {
    if (visibleCount === 0 || visibleCount >= chunking.boxes.length) return
    // The gate, restated: the NEXT box must already be playable. The chevron is hidden when this is
    // false, so this guard only catches a click on a stale render.
    if (settledBoxCount < visibleCount + 1) return
    setAdvanced((count) => count + 1)
    setClickedAt((prev) => ({ ...prev, [visibleCount]: performance.now() - startedAtRef.current }))
  }, [chunking.boxes.length, settledBoxCount, visibleCount])

  // Stress modes. `reader` paces at a settable reading speed; `impatient` clicks the instant the
  // chevron appears, which is what finds the places the gate opens too early. Both advance from a
  // timer callback, so neither is a synchronous setState inside an effect body.
  useEffect(() => {
    if (!active || liveSettings.stress === 'manual') return
    if (visibleCount === 0 || visibleCount >= chunking.boxes.length) return
    if (settledBoxCount < visibleCount + 1) return
    const box = chunking.boxes[visibleCount - 1] ?? ''
    const delay =
      liveSettings.stress === 'impatient' ? 0 : (box.length / Math.max(1, liveSettings.readingCps)) * 1000
    const timer = setTimeout(advance, delay)
    return () => clearTimeout(timer)
  }, [
    active,
    liveSettings.stress,
    liveSettings.readingCps,
    visibleCount,
    settledBoxCount,
    chunking.boxes,
    advance,
  ])

  const start = useCallback((script: string, settings: LabSettings) => {
    const chunks = buildChunking(script, settings.maxChars, settings.unit)
    if (chunks.boxes.length === 0) return
    runCounter.current += 1
    startedAtRef.current = performance.now()
    playedRef.current = -1
    setAdvanced(0)
    setClickedAt({})
    setActive({ id: runCounter.current, settings, chunking: chunks })
  }, [])

  const reset = useCallback(() => {
    audio.stop()
    playedRef.current = -1
    setActive(null)
    setAdvanced(0)
    setClickedAt({})
  }, [audio])

  return useMemo(
    () => ({
      active,
      visibleCount,
      settledBoxCount,
      canReveal,
      isRevealing,
      revealedAt,
      advance,
      start,
      reset,
      audio,
    }),
    [active, visibleCount, settledBoxCount, canReveal, isRevealing, revealedAt, advance, start, reset, audio],
  )
}
