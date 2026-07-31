import { ChevronRight } from 'lucide-react'

interface SceneTextBoxProps {
  /** Display name for the plate; null is the narrator, who speaks without one. */
  speaker: string | null
  /** The chunk the player has advanced to - never the whole line. */
  text: string
  isRevealing: boolean
  onAdvance: () => void
}

/**
 * The visual-novel text box, shared by narration and roleplay so a cut between them does not read
 * as a cut between two different games. Shows the current chunk and nothing else: everything
 * already read lives in the sidebar's story log, which is where a player goes back for it, so the
 * scene never turns into a wall of text scrolling over the art.
 *
 * The advance chevron rides beside the text rather than under it - stacking it there sandwiched it
 * against the input row below.
 */
export function SceneTextBox({ speaker, text, isRevealing, onAdvance }: SceneTextBoxProps) {
  if (!text && !speaker) return null

  return (
    <div className="relative">
      {speaker && (
        <span className="absolute -top-3 left-4 z-10 rounded-md border border-amber-200/40 bg-gradient-to-b from-amber-500/90 to-amber-700/90 px-3 py-0.5 text-sm font-semibold text-amber-50 shadow-lg">
          {speaker}
        </span>
      )}
      <div className="rounded-xl border border-white/15 bg-black/75 px-5 pb-4 pt-5 shadow-2xl backdrop-blur">
        <div className="flex items-end gap-3">
          <p className="min-h-14 flex-1 text-base leading-relaxed text-white sm:text-lg" aria-live="polite">
            {text}
          </p>
          {isRevealing && (
            <button
              type="button"
              onClick={onAdvance}
              aria-label="Show more of this line"
              className="pointer-events-auto shrink-0 text-white/70 transition-colors hover:text-white"
            >
              <ChevronRight className="size-9 animate-pulse" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
