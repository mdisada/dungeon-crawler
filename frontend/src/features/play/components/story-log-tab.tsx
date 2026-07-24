import { useEffect, useRef } from 'react'

import { usePlay } from '../hooks/use-play-context'

/**
 * Full dialogue history for review: the renderers deliver a line a sentence at a time, so this is
 * where a player re-reads what was said. Chronological, newest last, scrolled to the newest entry
 * on open - `state.dialogue.lines` is the same bounded history the scene renderers draw from.
 */
export function StoryLogTab() {
  const { state } = usePlay()
  const { lines } = state.dialogue
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Optional-called: jsdom (tests) has no Element.scrollIntoView.
    endRef.current?.scrollIntoView?.({ block: 'end' })
  }, [lines.length])

  if (lines.length === 0) {
    return <p className="text-sm text-muted-foreground">The story has not started yet.</p>
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      {lines.map((line) => (
        <div key={line.id}>
          {line.speaker && (
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{line.speaker}</p>
          )}
          <p className="leading-relaxed">{line.text}</p>
        </div>
      ))}
      <div ref={endRef} aria-hidden />
    </div>
  )
}
