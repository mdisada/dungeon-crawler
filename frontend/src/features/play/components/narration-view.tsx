import { ChevronRight } from 'lucide-react'

import { cn } from '@/lib/utils'
import type { SceneState } from '@rules/state'

import { usePlay } from '../hooks/use-play-context'

interface NarrationViewProps {
  scene: SceneState
}

/**
 * F06 SS3.2 cinematic renderer: full-bleed background with a slow Ken Burns pan and bottom-third
 * subtitles. The active line is delivered a chunk at a time - whole sentences, capped so the box
 * never overflows - and the player clicks to advance, so each advance is also where F12 starts
 * that chunk's narration audio.
 *
 * The box shows the current chunk and nothing else: it is a visual-novel subtitle, not a
 * transcript. Everything already read lives in the sidebar's story log, which is where a player
 * goes back for it - so the scene never turns into a wall of text scrolling over the art.
 *
 * Nothing here signals generation: once the player has caught up, the input row's "DM is
 * thinking" indicator is the one place that says wait.
 */
export function NarrationView({ scene }: NarrationViewProps) {
  const { reveal } = usePlay()
  const { chunks, visibleCount, isRevealing, advance } = reveal

  const current = visibleCount > 0 ? chunks[visibleCount - 1] : ''

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
          order and out of the accessibility tree instead of duplicating it. The subtitle box on
          top of it is pointer-transparent, so a click anywhere - text included - advances. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        disabled={!isRevealing}
        onClick={advance}
        className={cn('absolute inset-0', isRevealing ? 'cursor-pointer' : 'cursor-default')}
      />

      {/* Same px/max-w as IntentInputRow so the text sits in the same column. The advance chevron
          rides beside the text, not under it - stacking it there sandwiched it against the input
          row below. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 px-4 pb-28">
        <div className="mx-auto flex w-full max-w-4xl items-end gap-3">
          <p className="min-h-20 flex-1 text-lg leading-relaxed text-white drop-shadow" aria-live="polite">
            {current}
          </p>
          {isRevealing && (
            <button
              type="button"
              onClick={advance}
              aria-label="Show more of this line"
              className="pointer-events-auto shrink-0 text-white/70 drop-shadow transition-colors hover:text-white"
            >
              <ChevronRight className="size-9" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
