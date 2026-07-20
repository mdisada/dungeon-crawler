import { useEffect, useState } from 'react'

import type { DialogueLine } from '@rules/state'

const REVEAL_INTERVAL_MS = 2200

/**
 * Sentence-by-sentence reveal cadence for the active line (F06 SS3.2) - stands in for TTS
 * playback progress until F12. Consumers (scene renderers, the intent input row) stay in sync
 * because they all key off the same activeLineId change from the same broadcast.
 */
export function useLineReveal(active: DialogueLine | null) {
  const sentences = active ? (active.text.match(/[^.!?]+[.!?]*\s*/g) ?? [active.text]) : []

  // Reset on line change - render-time adjustment (react.dev "adjusting state"), not an effect.
  const [reveal, setReveal] = useState<{ lineId: string | null; count: number }>({ lineId: null, count: 0 })
  if (reveal.lineId !== (active?.id ?? null)) {
    setReveal({ lineId: active?.id ?? null, count: sentences.length > 0 ? 1 : 0 })
  }

  useEffect(() => {
    if (!active || sentences.length <= 1) return
    const timer = setInterval(() => {
      setReveal((prev) =>
        prev.lineId === active.id && prev.count < sentences.length ? { ...prev, count: prev.count + 1 } : prev,
      )
    }, REVEAL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [active, sentences.length])

  return {
    sentences,
    visibleCount: reveal.count,
    isRevealing: active !== null && reveal.count < sentences.length,
  }
}
