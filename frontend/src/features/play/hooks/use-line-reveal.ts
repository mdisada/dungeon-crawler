import { useCallback, useMemo, useState } from 'react'

import type { DialogueLine } from '@rules/state'

import { chunkSentences } from '../sentences'

export interface LineReveal {
  /** The line the scene box is delivering - not always `dialogue.activeLineId`, see the provider. */
  line: DialogueLine | null
  /** The line cut into per-click pieces: whole sentences, capped at what the box can hold. */
  chunks: string[]
  /** How many chunks of the active line the player has asked for (1-based). */
  visibleCount: number
  /** True while the line still has chunks the player has not advanced to. */
  isRevealing: boolean
  advance: () => void
}

/**
 * Player-paced delivery of the active line (F06 SS3.2), visual-novel style: the renderers show
 * one chunk - whole sentences up to the box's character budget - and the player clicks for the
 * next, so a long reply arrives as beats instead of a wall of text. Lives in the play context so
 * the renderers and the input row share one pace - `isRevealing` is what tells the input row the
 * player has not caught up with the story yet.
 *
 * `advance` moving to chunk N is also the cue F12 will use to start that chunk's audio.
 */
export function useLineReveal(active: DialogueLine | null): LineReveal {
  const chunks = useMemo(() => (active ? chunkSentences(active.text) : []), [active])

  // Reset on line change - render-time adjustment (react.dev "adjusting state"), not an effect.
  const [reveal, setReveal] = useState<{ lineId: string | null; count: number }>({ lineId: null, count: 0 })
  if (reveal.lineId !== (active?.id ?? null)) {
    setReveal({ lineId: active?.id ?? null, count: chunks.length > 0 ? 1 : 0 })
  }

  const advance = useCallback(() => {
    setReveal((prev) => (prev.count < chunks.length ? { ...prev, count: prev.count + 1 } : prev))
  }, [chunks.length])

  const count = reveal.count
  return useMemo(
    () => ({
      line: active,
      chunks,
      visibleCount: count,
      isRevealing: count < chunks.length,
      advance,
    }),
    [active, chunks, count, advance],
  )
}
