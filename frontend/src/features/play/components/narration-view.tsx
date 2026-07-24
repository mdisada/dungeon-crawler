import { ChevronRight } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import type { DialogueState, SceneState } from '@rules/state'

import { usePlay } from '../hooks/use-play-context'

interface NarrationViewProps {
  scene: SceneState
  dialogue: DialogueState
}

/**
 * F06 SS3.2 cinematic renderer: full-bleed background with a slow Ken Burns pan, bottom-third
 * subtitles, history on scroll-up. The active line is delivered one sentence at a time and the
 * player clicks to advance (visual-novel pacing) - so each advance is also the point where F12
 * starts that sentence's narration audio. Nothing here signals generation: once the player has
 * caught up, the input row's "DM is thinking" indicator is the one place that says wait.
 */
export function NarrationView({ scene, dialogue }: NarrationViewProps) {
  const { reveal } = usePlay()
  const active = dialogue.lines.find((l) => l.id === dialogue.activeLineId) ?? null
  const history = dialogue.lines.filter((l) => l.id !== active?.id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { sentences, visibleCount, isRevealing, advance } = reveal

  const read = sentences.slice(0, Math.max(visibleCount - 1, 0)).join('')
  const current = visibleCount > 0 ? sentences[visibleCount - 1] : ''

  useEffect(() => {
    // Optional-called: jsdom (tests) has no Element.scrollTo.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [visibleCount, dialogue.lines.length])

  return (
    <div className="relative h-full w-full overflow-hidden bg-black">
      {scene.backgroundUrl ? (
        <img
          src={scene.backgroundUrl}
          alt={scene.locationName || 'Scene background'}
          className="ken-burns absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="absolute inset-0 bg-gradient-to-b from-slate-800 via-slate-900 to-black"
        />
      )}
      <div className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black/85 to-transparent" />

      {/* Click the scene to advance, the visual-novel convention. Mouse-only on purpose: the Next
          button below carries the label and the keyboard focus, so this one stays out of the tab
          order and out of the accessibility tree instead of duplicating it. It sits behind the
          subtitle box, which keeps its own pointer events for scroll-up history. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        disabled={!isRevealing}
        onClick={advance}
        className={cn('absolute inset-0', isRevealing ? 'cursor-pointer' : 'cursor-default')}
      />

      <div
        ref={scrollRef}
        className="absolute inset-x-0 bottom-0 max-h-[38%] overflow-y-auto px-6 pb-20 pt-2 sm:px-16"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {history.map((line) => (
            <p key={line.id} className="text-base leading-relaxed text-white/50">
              {line.text}
            </p>
          ))}
          {read && <p className="text-base leading-relaxed text-white/50">{read}</p>}
          {current && (
            <p className="text-lg leading-relaxed text-white drop-shadow" aria-live="polite">
              {current}
            </p>
          )}
          {isRevealing && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={advance}
                aria-label="Show the next sentence"
                className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-1 text-xs text-white/80 transition-colors hover:bg-white/20 hover:text-white"
              >
                Next
                <ChevronRight className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
