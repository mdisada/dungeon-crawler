import { cn } from '@/lib/utils'
import type { DialogueState, PlayersState, SceneState } from '@rules/state'

import { usePlay } from '../hooks/use-play-context'
import { PartyStrip } from './party-strip'
import { SceneBackdrop } from './scene-backdrop'
import { SceneTextBox } from './scene-text-box'
import { SpeakerStage } from './speaker-stage'

interface RoleplayViewProps {
  scene: SceneState
  dialogue: DialogueState
  players: PlayersState
}

/**
 * F06 SS3.3 visual-novel renderer: location background, half-body NPC cutouts left/right with the
 * active speaker stepped forward, the party bar along the bottom (the directly-addressed PC
 * highlighted, F10 SS3.7), and the name-plated text box. The Say/Do/Roll input row is the play
 * page's IntentInputRow overlay.
 *
 * The line is delivered a chunk at a time - whole sentences, capped so the box never overflows -
 * and the player clicks to advance, same as the narration renderer, so each advance is also where
 * F12 starts that chunk's audio. Nothing here signals generation: the input row's "DM is thinking"
 * indicator owns that, and only once the player has caught up.
 */
export function RoleplayView({ scene, dialogue, players }: RoleplayViewProps) {
  const { reveal } = usePlay()
  // The revealed line, not dialogue.activeLineId: the party's own utterances never take the box.
  const { line: active, chunks, visibleCount, canAdvance, advance } = reveal
  const current = visibleCount > 0 ? chunks[visibleCount - 1] : ''

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-black">
      <SceneBackdrop scene={scene} />
      <SpeakerStage speakers={dialogue.speakers} speakingNpcId={active?.npcId ?? null} />

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

      {/* mb clears the input row and its suggestion chips, which overlay the bottom. */}
      <div className="pointer-events-none relative z-10 mx-auto mb-24 mt-auto flex w-full max-w-4xl flex-col gap-3 px-4">
        <PartyStrip players={players.list} addressedCharacterId={dialogue.addressedCharacterId} />
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
