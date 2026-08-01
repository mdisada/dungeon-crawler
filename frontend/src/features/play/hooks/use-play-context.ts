import { createContext, useContext } from 'react'

import type { FxEvent, GameState } from '@rules/state'

import type { ConnectionStatus, MemberAdventure, PlayRole } from '../types'
import type { NarrationDelivery } from './use-narration'
import type { MediaResolver } from './use-play-media'

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
  /** Narration audio level. Zero (or muted) means this client neither waits for nor asks for it. */
  narrationVolume: number
  isMuted: boolean
}

export interface PlayContextValue extends PlayContextInput {
  /** Shared sentence pace for the active line - the renderers drive it, the input row reads it. */
  reveal: NarrationDelivery
  /** MediaRef -> signed URL, re-signed on a timer. See usePlayMedia. */
  media: MediaResolver
}

export const PlayContext = createContext<PlayContextValue | null>(null)

export function usePlay(): PlayContextValue {
  const context = useContext(PlayContext)
  if (!context) throw new Error('usePlay must be used within a PlayProvider')
  return context
}
