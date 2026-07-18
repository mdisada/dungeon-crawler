import { createContext, useContext } from 'react'

import type { FxEvent, GameState } from '@rules/state'

import type { ConnectionStatus, MemberAdventure, PlayRole } from '../types'

export interface PlayContextValue {
  adventure: MemberAdventure
  userId: string
  state: GameState
  version: number
  role: PlayRole
  isSpectator: boolean
  connection: ConnectionStatus
  fx: FxEvent[]
}

export const PlayContext = createContext<PlayContextValue | null>(null)

export function usePlay(): PlayContextValue {
  const context = useContext(PlayContext)
  if (!context) throw new Error('usePlay must be used within a PlayProvider')
  return context
}
