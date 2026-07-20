export {
  extractJson,
  parseAdjudication,
  parseConsistency,
  parseNarrationOptions,
  parseNpcOutput,
  parseSocialClassification,
} from './adjudication.ts'
export type { ConsistencyVerdict, ParsePlayResult } from './adjudication.ts'
export {
  applyAssist,
  ASSIST_PROMPT_WINDOW_S,
  clampDc,
  DC_MAX,
  DC_MIN,
  GROUP_PROMPT_WINDOW_S,
  groupOutcome,
  promptDeadline,
  promptExpired,
  rollCheck,
  SOCIAL_DC,
  socialDc,
  SOLO_PROMPT_WINDOW_S,
} from './checks.ts'
export {
  checkGateActive, DEFAULT_DM_SETTINGS, dialogueGateActive, dmSettings, GIST_COUNT, parseGists,
} from './review.ts'
export type { CheckGateContext, DialogueGateContext } from './review.ts'
export { liveRng, rollDie, seededRng } from './rng.ts'
export type { Rng } from './rng.ts'
export {
  DANGER_MAX, dangerScore, fallbackEncounterTable, parseEncounterTable, pickWeighted, rollSpawn,
  spawnThreshold,
} from './danger.ts'
export type { DangerModifiers, EncounterTableEntry, SpawnRoll } from './danger.ts'
export { DEFAULT_HINT_TURNS, decideHint } from './hints.ts'
export type { HintDecisionInput, HintRung } from './hints.ts'
export { newPuzzle, puzzleSolvedTier, recordPuzzleAttempt } from './puzzle.ts'
export type {
  PuzzleAttemptOutcome, PuzzleAttemptResult, PuzzleProgress, PuzzleSeed, PuzzleStatus,
} from './puzzle.ts'
export {
  challengeStatus, DC_ESCALATION_PER_REPEAT, escalatedDc, newSkillChallenge, recordAttempt,
} from './skill-challenge.ts'
export type { AttemptOutcome, ChallengeSeed, ChallengeStatus, SkillChallengeState } from './skill-challenge.ts'
export { classifyIntent } from './router.ts'
export type { RouterScene } from './router.ts'
export {
  actionAutoAllowed,
  canConsumeOpening,
  cappedSceneDelta,
  clampDisposition,
  clampDispositionDelta,
  dispositionBand,
  effectiveDispositionDelta,
  filterLocationReveals,
  filterReveals,
  locationRevealVerdict,
  openingDcMod,
  revealVerdict,
  SCENE_DISPOSITION_DRIFT_MAX,
} from './social.ts'
export type {
  DispositionBand, DispositionTrigger, LocationRevealContext, RevealContext, RevealVerdict,
} from './social.ts'
export type {
  AdjudicationOutput,
  AdjudicationResolution,
  AdvDis,
  CheckResult,
  CheckSpec,
  DispositionDelta,
  IntentEnvelope,
  IntentKind,
  IntentRoute,
  NpcAgentOutput,
  NpcProposedAction,
  OpeningView,
  PendingPrompt,
  ProposalStatus,
  ProposalView,
  RequiresAssist,
  RevealCandidate,
  SocialClassification,
  SocialMagnitude,
} from './types.ts'
