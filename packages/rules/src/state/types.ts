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
  /** Solo checks: 1-3 pickable skills (`skill` first); absent = single-skill roll. */
  skillOptions?: string[]
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
  /** Party ledger (F08 SS2.1): quest payouts credit here. Items/XP stay narrative until F11. */
  gold: number
}

export interface ObjectiveView {
  id: string
  /** Revealed player-facing title only - hidden descriptions never enter GameState. */
  title: string
  state: 'revealed' | 'active' | 'completed'
}

/** An unresolved quest offer on the table (F08 SS2.1 banner) - the negotiation ceiling never enters GameState. */
export interface OfferBannerView {
  id: string
  label: string
  giverName: string
  /** Currently offered gold (floor or negotiated up). */
  gold: number
  stakes: string
}

/** Accepted quest in the minimal journal (F08 SS2.2), terms as accepted. */
export interface QuestJournalView {
  id: string
  label: string
  giverName: string
  gold: number
  stakes: string
  status: 'active' | 'suspended' | 'completed'
}

export interface ObjectivesState {
  currentId: string | null
  list: ObjectiveView[]
  /** Open offers awaiting the party's answer (at most 2 - F08 SS2.1). */
  offers: OfferBannerView[]
  /** The quest journal: accepted quests mapped onto the loop stack (F08 SS2.2). */
  quests: QuestJournalView[]
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
  /** Idle-nudge threshold in minutes (F08 SS9.1); absent = default 3. */
  nudgeMinutes?: number
  /** Stuck-hint auto-detector threshold in no-progress turns; absent = default 3. */
  hintTurns?: number
  /** Progress Director threshold overrides (Phase 3); absent fields use the defaults. */
  directorThresholds?: {
    nudge?: number
    reveal?: number
    replanBeat?: number
    guaranteedRoute?: number
    failForward?: number
    offerPressure?: number
  }
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

/**
 * Hidden half of the open encounter (encounter-states Slice 2): outcome maps + kind-specific
 * secrets (e.g. a puzzle's solution). Lives on the dm domain so it never reaches players;
 * the visible frame is GameState.encounter.
 */
export interface EncounterSpecState {
  onSuccess: string[]
  onPartial: string[]
  onFailure: string[]
  params?: Json
  /** Hidden half of the interrupted encounter, restored with its frame (Slice 6). */
  interrupted?: EncounterSpecState | null
}

/** DM-only domains, stripped from player resyncs and broadcast on dm:{id} only. */
export interface DmState {
  /** Full objective checklist incl. hidden ones (DM overview tab). */
  objectives: { id: string; title: string; hidden: boolean; state: string }[]
  /** Proposal audit trail, newest first (bounded). */
  proposals: ProposalEntry[]
  /**
   * Consistency fact base (F07 SS6) + predicate world state (F08 SS9): npcStates feed the
   * checker and ending signals; world/flags are the fact/flag atoms objective and beat
   * predicates evaluate against (written by dm_command overrides and story events).
   */
  facts: {
    npcStates: { [npcId: string]: string }
    world?: { [path: string]: Json }
    flags?: { [flag: string]: Json }
  }
  conversation: ConversationState
  /** Optional: absent in states persisted before Slice 2 - read via dmSettings()/pendingReview helpers. */
  settings?: DmSettingsState
  pendingReview?: PendingReviewState | null
  /**
   * F08 story bookkeeping (optional, absent pre-Phase 6): the off-loop mismatch streak, plus
   * the Progress Director's per-turn counters (overhaul Phase 3 - see story/director.ts).
   */
  story?: {
    offLoopStreak: number
    director?: {
      turnsSinceProgress: number
      turnsOnObjective: number
      offerPendingTurns: number
      rung: number
      lastRungTurn: number
    }
  }
  /** Hidden spec of the open encounter; null/absent when no encounter is open. */
  encounterSpec?: EncounterSpecState | null
  /**
   * Compacted agent context (optional, absent pre-compaction). Closed phases collapse to a
   * one-line digest and their raw transcript stops being sent to agents - the payload, not the
   * chain length, is what grew all session and blew the worker's resource ceiling. Players are
   * unaffected: dialogue.lines keeps the full scroll-back.
   */
  contextWindow?: ContextWindowState
}

export interface ContextWindowState {
  /** Newest last, bounded - one per closed phase. */
  digests: string[]
  /** Raw lines from this id onward are still live context; everything older is digested. */
  sinceLineId: string | null
}

export type EncounterKind = 'skill_challenge' | 'puzzle' | 'social' | 'combat'

/**
 * Typed encounter frame (encounter-states redesign): the story spine advances only through
 * resolvable encounters. `progress` is kind-specific plain data; `contributions` counts each
 * PC's success-attempts (feeds the full-participation tier and hint pacing). Player-visible -
 * the UI renders the frame like the check prompt.
 */
export interface EncounterState {
  id: string
  kind: EncounterKind
  label: string
  stakes: string
  progress: Json
  contributions: Record<string, number>
  startedAt: string
  /** Single-depth interrupt stack (Slice 6): a random spawn preserves the encounter it cut off. */
  interrupted?: EncounterState | null
}

export interface GameState {
  scene: SceneState
  dialogue: DialogueState
  combat: CombatState | null
  players: PlayersState
  objectives: ObjectivesState
  session: SessionState
  dm: DmState | null
  /** Optional: absent in states persisted before the encounter-states redesign. */
  encounter?: EncounterState | null
}

export type DiffDomain = 'scene' | 'dialogue' | 'combat' | 'players' | 'objectives' | 'session' | 'dm' | 'encounter'

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
    players: { list: [], gold: 0 },
    objectives: { currentId: null, list: [], offers: [], quests: [] },
    session: { id: null, index: 0, status: 'lobby', recap: null },
    encounter: null,
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
