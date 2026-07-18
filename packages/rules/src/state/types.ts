// Live GameState contract (F06 SS6): everything the adventure page renders derives from this
// shape, delivered as per-domain diffs over the game:{adventure_id} channel. Owned by the
// single writer (the session function now, F07's Adventure Manager later). Plain data only -
// runs under Vitest, the frontend bundle, and the Deno edge runtime (relative imports with
// explicit .ts extensions, no platform APIs).

export type Json = string | number | boolean | null | Json[] | { [key: string]: Json }

export type SceneMode = 'narration' | 'roleplay' | 'battle' | 'puzzle' | 'downtime'

/** Grid side length of every battle map (F04/F06: 32x32 over a 1024x1024 image). */
export const GRID_SIZE = 32

export interface SceneState {
  mode: SceneMode
  /** Background XOR map - decided upstream by the Scene Manager, never by the client. */
  activeVisual: 'background' | 'map'
  locationId: string | null
  locationName: string
  backgroundUrl: string | null
  musicTrack: string | null
  /** In-game day from the World Clock (F06 header). */
  day: number
}

export interface DialogueLine {
  id: string
  /** Display name; null speaker = narrator voice. */
  speaker: string | null
  npcId: string | null
  text: string
}

export interface SpeakerSlot {
  npcId: string
  name: string
  side: 'left' | 'right'
  imageUrl: string | null
}

/**
 * Live table prompt (F07 SS3.4): solo check waiting on its actor, group check collecting
 * rolls, or an open assist slot. Shape defined in ../play/types.ts; carried in GameState as
 * plain data. One at a time - rulings block the pipeline.
 */
export interface PendingPromptState {
  kind: 'check' | 'group' | 'assist'
  id: string
  skill: string
  reason: string
  deadline: string
  actorCharacterId?: string
  advDis?: 'none' | 'advantage' | 'disadvantage'
  memberCharacterIds?: string[]
  rolled?: { characterId: string; total: number; success: boolean }[]
  primaryCharacterId?: string
  primarySkill?: string
  effect?: 'enable' | 'bonus'
}

/** Social opening chip (F10 SS3.7) - consumable by any PC except the one who unlocked it. */
export interface OpeningState {
  id: string
  unlockedBy: string
  npcId: string
  skill: string
  dcMod: number
  hint: string
}

export interface DialogueState {
  /** Bounded history, newest last (scroll-up history in the renderers). */
  lines: DialogueLine[]
  /** Line currently being revealed/spoken; older lines render instantly. */
  activeLineId: string | null
  /** Half-body portraits on stage in roleplay mode. */
  speakers: SpeakerSlot[]
  /** "DM is thinking" indicator while a blocking agent call runs (F07 SS4). */
  typing: boolean
  /** The one live check/assist prompt, or null. */
  pending: PendingPromptState | null
  /** Scene-scoped social openings; cleared when the encounter ends. */
  openings: OpeningState[]
  /** PC the current speaker is addressing directly (F10 SS3.7 thumbnail highlight). */
  addressedCharacterId: string | null
}

export interface HpState {
  current: number
  max: number
  temp: number
}

export interface TokenState {
  id: string
  kind: 'pc' | 'npc'
  /** characters.id or npcs.id. */
  refId: string
  name: string
  imageUrl: string | null
  x: number
  y: number
  hp: HpState | null
  conditions: string[]
  allegiance: 'party' | 'enemy' | 'neutral'
  controller: 'player' | 'dm' | 'ai'
  controllerUserId: string | null
  /** Movement per turn, in grid squares. */
  speed: number
}

export interface ActionEconomy {
  action: boolean
  bonus: boolean
  /** Remaining movement squares this turn. */
  move: number
  reaction: boolean
}

export interface CombatState {
  locationId: string | null
  mapUrl: string | null
  obstacles: [number, number][]
  tokens: TokenState[]
  /** Initiative order, highest first. */
  initiative: { tokenId: string; roll: number }[]
  round: number
  activeTokenId: string
  economy: ActionEconomy
}

export interface PlayerView {
  userId: string
  characterId: string
  name: string
  connected: boolean
  hp: HpState
  conditions: string[]
}

export interface PlayersState {
  list: PlayerView[]
}

export interface ObjectiveView {
  id: string
  /** Revealed player-facing title only - hidden descriptions never enter GameState. */
  title: string
  state: 'revealed' | 'active' | 'completed'
}

export interface ObjectivesState {
  currentId: string | null
  list: ObjectiveView[]
}

export interface SessionState {
  id: string | null
  index: number
  status: 'lobby' | 'active' | 'ended'
  /** "Previously on..." text rendered at session start (F05 SS4.1). */
  recap: string | null
}

/** Proposal audit entry surfaced in the DM tray (F07 SS4; read-only until Phase 10). */
export interface ProposalEntry {
  id: string
  type: string
  status: string
  summary: string
  createdAt: string
}

/** Standing automation policy for assist mode (Slice 2): what the AI may send unreviewed. */
export interface DmSettingsState {
  /** true = NPC replies/narration auto-send; false = gist review console gates them. */
  autoDialogue: boolean
  /** true = check outcomes stand; false = the DM confirms/flips each result (Slice 4). */
  autoChecks: boolean
}

export interface ReviewCandidate {
  id: string
  /** One-sentence direction for the reply, not the full line. */
  gist: string
}

export interface NpcReplyReview {
  id: string
  kind: 'npc_reply'
  npcId: string
  npcName: string
  utterance: { actorCharacterId: string; actorName: string; text: string }
  checkResult: { skill: string; success: boolean; margin: number } | null
  candidates: ReviewCandidate[]
  createdAt: string
}

/** Slice 3: gated narration beat (do-outcomes, fail-forwards, narrate-next). */
export interface NarrationReview {
  id: string
  kind: 'narration'
  /** Console heading, e.g. "Action outcome" or "Story narration". */
  label: string
  /** Narrator base prompt; the chosen gist is prepended as the direction on expansion. */
  prompt: string
  candidates: ReviewCandidate[]
  createdAt: string
}

/**
 * Slice 4: a rolled check outcome awaiting the DM's ruling (assist + autoChecks off). The
 * check stash stays in dm.conversation.pendingContext until accept/flip resumes the flow.
 */
export interface CheckRulingReview {
  id: string
  kind: 'check_ruling'
  actorName: string
  skill: string
  total: number
  dc: number
  success: boolean
  margin: number
  /** Human summary, e.g. "14 vs DC 15" or "group: 2/3 passed, needed 2". */
  detail: string
  createdAt: string
}

/**
 * Pending review (assist mode): gist reviews propose 3 directions the DM picks/steers from;
 * check rulings ask accept/flip. Player intents 409 while this is set - one review at a
 * time, cleared on send/dismiss/ruling.
 */
export type PendingReviewState = NpcReplyReview | NarrationReview | CheckRulingReview

/** Conversation State (F10 SS3): server-side scene memory, DM-visible only. */
export interface ConversationState {
  topicStack: string[]
  /** Ingredient ids revealed this scene. */
  revealedThisScene: string[]
  /** Stashed context for the in-flight check prompt (what to do once it resolves). */
  pendingContext: Json | null
}

/** DM-only domains, stripped from player resyncs and broadcast on dm:{id} only. */
export interface DmState {
  /** Full objective checklist incl. hidden ones (DM overview tab). */
  objectives: { id: string; title: string; hidden: boolean; state: string }[]
  /** Proposal audit trail, newest first (bounded). */
  proposals: ProposalEntry[]
  /**
   * Consistency fact base (F07 SS6): deterministic world facts the checker validates drafts
   * against, e.g. npcStates: { [npcId]: 'dead' | 'alive' | 'absent' }. Set via dm_command
   * overrides now; F8/F9 write these mechanically in later phases.
   */
  facts: { npcStates: { [npcId: string]: string } }
  conversation: ConversationState
  /** Optional: absent in states persisted before Slice 2 - read via dmSettings()/pendingReview helpers. */
  settings?: DmSettingsState
  pendingReview?: PendingReviewState | null
}

export interface GameState {
  scene: SceneState
  dialogue: DialogueState
  combat: CombatState | null
  players: PlayersState
  objectives: ObjectivesState
  session: SessionState
  dm: DmState | null
}

export type DiffDomain = 'scene' | 'dialogue' | 'combat' | 'players' | 'objectives' | 'session' | 'dm'

/**
 * One state-diff message. `patch` is an RFC 7386-style merge patch against that domain:
 * objects merge recursively, arrays and scalars replace, null deletes (or clears the whole
 * domain when the domain itself is nullable, e.g. combat end).
 */
export interface StateDiff {
  domain: DiffDomain
  patch: Json
}

/** Transient effects (floating damage numbers, etc.) - broadcast alongside diffs, never stored. */
export interface FxEvent {
  kind: 'damage' | 'heal' | 'banner'
  tokenId?: string
  value?: number
  text?: string
}

export function initialGameState(): GameState {
  return {
    scene: {
      mode: 'narration',
      activeVisual: 'background',
      locationId: null,
      locationName: '',
      backgroundUrl: null,
      musicTrack: null,
      day: 1,
    },
    dialogue: {
      lines: [],
      activeLineId: null,
      speakers: [],
      typing: false,
      pending: null,
      openings: [],
      addressedCharacterId: null,
    },
    combat: null,
    players: { list: [] },
    objectives: { currentId: null, list: [] },
    session: { id: null, index: 0, status: 'lobby', recap: null },
    dm: {
      objectives: [],
      proposals: [],
      facts: { npcStates: {} },
      conversation: { topicStack: [], revealedThisScene: [], pendingContext: null },
      settings: { autoDialogue: false, autoChecks: false },
      pendingReview: null,
    },
  }
}
