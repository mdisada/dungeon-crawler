import { createContext, useContext } from 'react'

import type { FxEvent, GameState } from '@rules/state'

import type { ConnectionStatus, MemberAdventure, PlayRole } from '../types'
import type { LineReveal } from './use-line-reveal'

/** What the provider is given; `reveal` is derived from it, so it isn't passed in. */
export interface PlayContextInput {
  adventure: MemberAdventure
  userId: string
  state: GameState
  version: number
  role: PlayRole
  isSpectator: boolean
  connection: ConnectionStatus
  fx: FxEvent[]
}

export interface PlayContextValue extends PlayContextInput {
  /** Shared sentence pace for the active line - the renderers drive it, the input row reads it. */
  reveal: LineReveal
}

export const PlayContext = createContext<PlayContextValue | null>(null)

export function usePlay(): PlayContextValue {
  const context = useContext(PlayContext)
  if (!context) throw new Error('usePlay must be used within a PlayProvider')
  return context
}
