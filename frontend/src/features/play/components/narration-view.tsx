import { cn } from '@/lib/utils'
import type { DialogueState, PlayersState, SceneState } from '@rules/state'

import { usePlay } from '../hooks/use-play-context'
import { PartyStrip } from './party-strip'
import { SceneBackdrop } from './scene-backdrop'
import { SceneTextBox } from './scene-text-box'
import { SpeakerStage } from './speaker-stage'

interface NarrationViewProps {
  scene: SceneState
  dialogue: DialogueState
  players: PlayersState
}

/**
 * F06 SS3.2 cinematic renderer: full-bleed background, the party bar along the bottom, and the
 * narrator's line in the same text box the roleplay renderer uses - the two modes are one place
 * with different people in it, and a cut between them should not look like a cut between two
 * games. The active line is delivered a chunk at a time - whole sentences, capped so the box never
 * overflows - and the player clicks to advance, so each advance is also where F12 starts that
 * chunk's narration audio.
 *
 * Anyone still staged keeps their place on stage, dimmed: an encounter resolving flips the scene
 * back to narration without clearing dialogue.speakers, and a cast that vanished for one beat and
 * reappeared for the next would read as a bug rather than a scene.
 *
 * Nothing here signals generation: once the player has caught up, the input row's "DM is thinking"
 * indicator is the one place that says wait.
 */
export function NarrationView({ scene, dialogue, players }: NarrationViewProps) {
  const { reveal } = usePlay()
  const { line: active, chunks, visibleCount, canAdvance, advance } = reveal
  const current = visibleCount > 0 ? chunks[visibleCount - 1] : ''

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <SceneBackdrop scene={scene} />
      {/* Narrator voice: nobody holds the box, so the whole stage stays dimmed. */}
      <SpeakerStage speakers={dialogue.speakers} speakingNpcId={null} />

      {/* Click the scene to advance, the visual-novel convention. Mouse-only on purpose: the
          chevron in the text box carries the label and the keyboard focus, so this one stays out
          of the tab order and out of the accessibility tree instead of duplicating it. The bottom
          column on top of it is pointer-transparent, so a click anywhere advances. */}
      <button
        type="button"
        aria-hidden
        tabIndex={-1}
        disabled={!canAdvance}
        onClick={advance}
        className={cn('absolute inset-0', canAdvance ? 'cursor-pointer' : 'cursor-default')}
      />

      <div className="pointer-events-none relative z-10 mx-auto mb-24 mt-auto flex w-full max-w-4xl flex-col gap-3 px-4">
        <PartyStrip players={players.list} />
        <SceneTextBox
          speaker={active?.speaker ?? null}
          text={current}
          canAdvance={canAdvance}
          onAdvance={advance}
        />
      </div>
    </div>
  )
}
