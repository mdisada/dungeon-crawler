import { useMemo } from 'react'

import type { DialogueLine, GameState } from '@rules/state'

import { useLineReveal } from '../hooks/use-line-reveal'
import { PlayContext } from '../hooks/use-play-context'
import type { PlayContextInput } from '../hooks/use-play-context'
import { usePlayMedia } from '../hooks/use-play-media'

interface PlayProviderProps extends PlayContextInput {
  children: React.ReactNode
}

/**
 * The line the scene box delivers: the active line, unless it is a party utterance.
 *
 * Every say route stages the player's own words as a dialogue line and points activeLineId at
 * them, so the box would echo what the player just sent and make them click past it to reach the
 * DM's reply. Skipping back to the last narrated line means the previous beat simply stays up
 * until the reply lands - and because the revealed line's id never changes while the DM thinks,
 * the player does not lose their place in it. The full transcript, party lines included, is the
 * sidebar's story log.
 *
 * A null activeLineId still means an empty box: the server clears it deliberately (staging a
 * social scene, ending a session) and a stale line must not creep back in.
 */
function narratedLine(state: GameState): DialogueLine | null {
  const { lines, activeLineId } = state.dialogue
  if (!activeLineId) return null
  const activeIndex = lines.findIndex((line) => line.id === activeLineId)
  if (activeIndex < 0) return null

  const partyNames = new Set(state.players.list.map((player) => player.name))
  for (let i = activeIndex; i >= 0; i--) {
    const line = lines[i]
    const isPartyLine = line.npcId == null && line.speaker != null && partyNames.has(line.speaker)
    if (!isPartyLine) return line
  }
  return null
}

export function PlayProvider({ children, ...value }: PlayProviderProps) {
  // One reveal for the whole play screen: the renderer the player clicks and the input row that
  // waits on them have to agree on how far into the line the table has got.
  const reveal = useLineReveal(narratedLine(value.state))
  // One signing pass for the whole screen: the backdrop, the cast on stage and every token on the
  // battle map are all pointing at storage paths that have to become URLs somewhere.
  const media = usePlayMedia(value.state)

  const memoized = useMemo(
    () => ({ ...value, reveal, media }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enumerate the fields, not the rest-object identity
    [value.adventure, value.userId, value.state, value.version, value.role, value.isSpectator, value.connection, value.fx, reveal, media],
  )
  return <PlayContext.Provider value={memoized}>{children}</PlayContext.Provider>
}
