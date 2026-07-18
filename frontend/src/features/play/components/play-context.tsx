import { useMemo } from 'react'

import { PlayContext } from '../hooks/use-play-context'
import type { PlayContextValue } from '../hooks/use-play-context'

interface PlayProviderProps extends PlayContextValue {
  children: React.ReactNode
}

export function PlayProvider({ children, ...value }: PlayProviderProps) {
  const memoized = useMemo(
    () => value,
    // eslint-disable-next-line react-hooks/exhaustive-deps -- enumerate the fields, not the rest-object identity
    [value.adventure, value.userId, value.state, value.version, value.role, value.isSpectator, value.connection, value.fx],
  )
  return <PlayContext.Provider value={memoized}>{children}</PlayContext.Provider>
}
