import { useMemo } from 'react'

import { useLineReveal } from '../hooks/use-line-reveal'
import { PlayContext } from '../hooks/use-play-context'
import type { PlayContextInput } from '../hooks/use-play-context'

interface PlayProviderProps extends PlayContextInput {
  children: React.ReactNode
}

export function PlayProvider({ children, ...value }: PlayProviderProps) {
  const { dialogue } = value.state
  const activeLine = dialogue.lines.find((l) => l.id === dialogue.activeLineId) ?? null
  // One reveal for the whole play screen: the renderer the player clicks and the input row that
  // waits on them have to agree on how far into the line the table has got.
  const reveal = useLineReveal(activeLine)

  const memoized = useMemo(
    () => ({ ...value, reveal }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enumerate the fields, not the rest-object identity
    [value.adventure, value.userId, value.state, value.version, value.role, value.isSpectator, value.connection, value.fx, reveal],
  )
  return <PlayContext.Provider value={memoized}>{children}</PlayContext.Provider>
}
