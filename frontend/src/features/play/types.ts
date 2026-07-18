// Play-feature local types. The GameState contract itself lives in @rules/state (single source
// shared with the session edge function via the _shared mirror).

import type { GameState } from '@rules/state'

export type PlayRole = 'dm' | 'player'

/** Row from the member_adventures view (the member-safe adventure surface). */
export interface MemberAdventure {
  id: string
  title: string
  status: string
  mode: 'full_ai' | 'assist' | null
  type: 'one_shot' | 'multi_chapter' | null
  minPlayers: number
  maxPlayers: number
  inviteCode: string
  creatorId: string
  isDemo: boolean
  createdAt: string
}

export interface LobbyMember {
  id: string
  userId: string
  role: PlayRole
  characterId: string | null
  ready: boolean
  spectator: boolean
  characterName: string | null
  characterLevel: number | null
  characterClass: string | null
  online: boolean
}

/** Own complete characters offered in the lobby picker. */
export interface PickableCharacter {
  id: string
  name: string
  level: number
  classKey: string | null
  lockedAdventureId: string | null
}

export type ConnectionStatus = 'connecting' | 'live' | 'reconnecting'

export interface PlaySnapshot {
  state: GameState
  version: number
  role: PlayRole
  spectator: boolean
}

export interface SessionEndedCard {
  sessionId: string
  index: number
  summary: Record<string, string[]>
  xpGained: number
  costUsd: number | null
}
