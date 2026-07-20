// The pending-check stashes: what a flow parks in dm.conversation.pendingContext while the
// table rolls, and picks back up in continueAfterCheck.
//
// Types only, deliberately. They used to live in the modules that create them, which forced
// npc-dialogue <-> intent and npc-dialogue <-> story into mutual imports just to name a shape.
// Every flow can depend on this leaf without depending on each other.

import type { CheckSpec } from '../_shared/play/index.ts'
import type { SceneEffects } from './agents.ts'

export interface SayUtterance {
  actorCharacterId: string
  actorName: string
  text: string
}

/** Free-text `do` adjudicated by the Adjudicator (F07 SS3.3). */
export interface DoCheckStash {
  flow: 'do'
  utterance: string
  actorCharacterId: string
  actorName: string
  interpretation: string
  consequencesHint: string
  spec: CheckSpec
  assistResult: { success: boolean; margin: number } | null
  /** Applied on check success only (full-AI); absent in pre-slice stashes. */
  sceneEffects?: SceneEffects | null
}

/** An influence/insight attempt inside a conversation (F10 SS3.2). */
export interface SocialCheckStash {
  flow: 'social'
  npcId: string
  utterance: SayUtterance
  skill: string
  dc: number
  openingId: string | null
}

/** Haggling over an open quest offer (F08 SS2.1). */
export interface NegotiateStash {
  flow: 'negotiate'
  offerId: string
  npcId: string | null
  utterance: SayUtterance
  skill: string
  dc: number
}

/** One attempt against an open skill challenge (encounter-states Slice 2). */
export interface ChallengeCheckStash {
  flow: 'challenge'
  utterance: string
  actorCharacterId: string
  actorName: string
  interpretation: string
  consequencesHint: string
  skill: string
  dc: number
  /** Per-option DCs (repeat-skill escalation differs per skill); rollPending picks by choice. */
  dcBySkill?: Record<string, number>
}

export type CheckStash = DoCheckStash | SocialCheckStash | NegotiateStash | ChallengeCheckStash
