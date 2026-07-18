import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import type { DialogueState, SceneState } from '@rules/state'

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
  const active = dialogue.lines.find((l) => l.id === dialogue.activeLineId)
  const history = dialogue.lines.filter((l) => l.id !== dialogue.activeLineId)
  const scrollRef = useRef<HTMLDivElement>(null)

  const sentences = active ? (active.text.match(/[^.!?]+[.!?]*\s*/g) ?? [active.text]) : []

  // Reset the reveal when the active line changes - render-time adjustment, not an effect.
  const [reveal, setReveal] = useState<{ lineId: string | null; count: number }>({ lineId: null, count: 0 })
  if (reveal.lineId !== (active?.id ?? null)) {
    setReveal({ lineId: active?.id ?? null, count: sentences.length > 0 ? 1 : 0 })
  }
  const visibleSentences = reveal.count

  useEffect(() => {
    if (!active || sentences.length <= 1) return
    // Sentence-level reveal cadence standing in for TTS playback progress (F06 SS3.2).
    const timer = setInterval(() => {
      setReveal((prev) =>
        prev.lineId === active.id && prev.count < sentences.length ? { ...prev, count: prev.count + 1 } : prev,
      )
    }, 2200)
    return () => clearInterval(timer)
  }, [active, sentences.length])

  useEffect(() => {
    // Optional-called: jsdom (tests) has no Element.scrollTo.
    scrollRef.current?.scrollTo?.({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [visibleSentences, dialogue.lines.length])

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
        className="absolute inset-x-0 bottom-0 max-h-[38%] overflow-y-auto px-6 pb-6 pt-2 sm:px-16"
      >
        <div className="mx-auto flex max-w-3xl flex-col gap-3">
          {history.map((line) => (
            <p key={line.id} className="text-base leading-relaxed text-white/60">
              {line.text}
            </p>
          ))}
          {active && (
            <p className="text-lg leading-relaxed text-white drop-shadow" aria-live="polite">
              {sentences.slice(0, visibleSentences).join('')}
              <span className={cn('inline-block w-2', visibleSentences < sentences.length && 'animate-pulse')}>
                {visibleSentences < sentences.length ? '…' : ''}
              </span>
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
