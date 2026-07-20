import { useEffect, useRef } from 'react'

import { cn } from '@/lib/utils'
import type { DialogueState, SceneState } from '@rules/state'

import { useLineReveal } from '../hooks/use-line-reveal'

interface NarrationViewProps {
  scene: SceneState
  dialogue: DialogueState
}

/**
 * F06 SS3.2 cinematic renderer: full-bleed background with a slow Ken Burns pan, bottom-third
 * subtitles with a timed sentence reveal (word-synced TTS drive arrives with F12), history on
 * scroll-up.
 */
export function NarrationView({ scene, dialogue }: NarrationViewProps) {
  const active = dialogue.lines.find((l) => l.id === dialogue.activeLineId) ?? null
  const history = dialogue.lines.filter((l) => l.id !== active?.id)
  const scrollRef = useRef<HTMLDivElement>(null)
  const { sentences, visibleCount, isRevealing } = useLineReveal(active)

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

      <div
        ref={scrollRef}
        className="absolute inset-x-0 bottom-0 max-h-[38%] overflow-y-auto px-6 pb-20 pt-2 sm:px-16"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {history.map((line) => (
            <p key={line.id} className="text-base leading-relaxed text-white/60">
              {line.text}
            </p>
          ))}
          {active && (
            <p className="text-lg leading-relaxed text-white drop-shadow" aria-live="polite">
              {sentences.slice(0, visibleCount).join('')}
              <span className={cn('inline-block w-2', isRevealing && 'animate-pulse')}>
                {isRevealing ? '…' : ''}
              </span>
            </p>
          )}
          {dialogue.typing && (
            <p className="flex items-center gap-1.5" role="status" aria-label="The DM is thinking">
              <span className="size-2 animate-bounce rounded-full bg-white/80" />
              <span className="size-2 animate-bounce rounded-full bg-white/80 [animation-delay:150ms]" />
              <span className="size-2 animate-bounce rounded-full bg-white/80 [animation-delay:300ms]" />
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
