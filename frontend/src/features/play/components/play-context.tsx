import { useMemo } from 'react'

import type { DialogueLine, GameState } from '@rules/state'

import { useNarration } from '../hooks/use-narration'
import { PlayContext } from '../hooks/use-play-context'
import type { PlayContextInput } from '../hooks/use-play-context'
import { usePlayMedia } from '../hooks/use-play-media'

interface PlayProviderProps extends PlayContextInput {
  children: React.ReactNode
}

/**
 * Every line the scene box may still deliver, oldest first, ending at the active one.
 *
 * A QUEUE rather than "the active line" (2026-08-01). The server points activeLineId at the newest
 * line it wrote, so a beat the player had not finished used to be replaced by the one after it.
 * Session start is where that showed: it stages the recap and the party's intros in one write, then
 * the entry-giver's scene lands seconds later and moved the box to it, so most of the opening was
 * never read. The player now walks the queue; new lines land behind where they are.
 *
 * Party utterances are dropped, not queued. Every say route stages the player's own words and
 * points activeLineId at them, and the box echoing what they just typed is not a beat to read. The
 * full transcript, party lines included, is the sidebar's story log.
 *
 * A null activeLineId still means an empty box: the server clears it deliberately (staging a
 * social scene, ending a session) and a stale line must not creep back in.
 */
function narratableQueue(state: GameState): DialogueLine[] {
  const { lines, activeLineId } = state.dialogue
  if (!activeLineId) return []
  const activeIndex = lines.findIndex((line) => line.id === activeLineId)
  if (activeIndex < 0) return []

  const partyNames = new Set(state.players.list.map((player) => player.name))
  return lines
    .slice(0, activeIndex + 1)
    .filter((line) => !(line.npcId == null && line.speaker != null && partyNames.has(line.speaker)))
}

export function PlayProvider({ children, ...value }: PlayProviderProps) {
  const queue = useMemo(() => narratableQueue(value.state), [value.state])
  // One reveal for the whole play screen: the renderer the player clicks and the input row that
  // waits on them have to agree on how far into the line the table has got. Since F12 it is also
  // where narration audio is gated - the line on screen is held until its first clip is playable.
  const reveal = useNarration({
    adventureId: value.adventure.id,
    queue,
    narrationVolume: value.narrationVolume,
    isMuted: value.isMuted,
  })
  // One signing pass for the whole screen: the backdrop, the cast on stage and every token on the
  // battle map are all pointing at storage paths that have to become URLs somewhere.
  const media = usePlayMedia(value.state)

  const memoized = useMemo(
    () => ({ ...value, reveal, media }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enumerate the fields, not the rest-object identity
    [value.adventure, value.userId, value.state, value.version, value.role, value.isSpectator, value.connection, value.fx, value.narrationVolume, value.isMuted, reveal, media],
  )
  return <PlayContext.Provider value={memoized}>{children}</PlayContext.Provider>
}
