import { useCallback, useMemo, useState } from 'react'

import type { DialogueLine } from '@rules/state'

import { splitSentences } from '../sentences'

export interface LineReveal {
  sentences: string[]
  /** How many sentences of the active line the player has asked for (1-based). */
  visibleCount: number
  /** True while the line still has sentences the player has not advanced to. */
  isRevealing: boolean
  advance: () => void
}

/**
 * Player-paced, sentence-by-sentence delivery of the active line (F06 SS3.2), visual-novel
 * style: the renderers show one sentence and the player clicks for the next. Lives in the play
 * context so the renderers and the input row share one pace - `isRevealing` is what tells the
 * input row the player has not caught up with the story yet.
 *
 * `advance` moving to sentence N is also the cue F12 will use to start that sentence's audio.
 */
export function useLineReveal(active: DialogueLine | null): LineReveal {
  const sentences = useMemo(() => (active ? splitSentences(active.text) : []), [active])

  // Reset on line change - render-time adjustment (react.dev "adjusting state"), not an effect.
  const [reveal, setReveal] = useState<{ lineId: string | null; count: number }>({ lineId: null, count: 0 })
  if (reveal.lineId !== (active?.id ?? null)) {
    setReveal({ lineId: active?.id ?? null, count: sentences.length > 0 ? 1 : 0 })
  }

  const advance = useCallback(() => {
    setReveal((prev) => (prev.count < sentences.length ? { ...prev, count: prev.count + 1 } : prev))
  }, [sentences.length])

  const count = reveal.count
  return useMemo(
    () => ({
      sentences,
      visibleCount: count,
      isRevealing: count < sentences.length,
      advance,
    }),
    [sentences, count, advance],
  )
}
