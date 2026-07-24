export {
  canonicalizeAtomSlug, editDistance, isNearMiss, MAX_LOCAL_ATOMS_PER_BEAT, registerLocalAtoms,
  resolveAtomText, rewritePredicateAtoms, suggestAtomTexts,
} from './atoms.ts'
export type { AtomKind, AtomProposal, AtomResolution, AtomScope, RegisterResult, RegistryAtom } from './atoms.ts'
export {
  coercePredicateEq, ENCOUNTER_KINDS, listPredicateAtomNames, MAX_CREATED_NPCS_PER_BEAT, parseBeatPlan, parseOutcomeMaps,
} from './beats.ts'
export type {
  BeatEncounterKind, BeatEncounterSpec, BeatParseResult, BeatPlan, BeatPlanContext, BraidedPair,
  IngredientRequest, NpcProposal, OutcomeMaps,
} from './beats.ts'
export {
  MISMATCH_THRESHOLD, nextStreak, parsePivot, PIVOT_AUTO_CONFIDENCE, PIVOT_PROPOSE_CONFIDENCE,
  PIVOT_REEVALUATE_EVENTS, pivotHandling, streakTriggersClassifier,
} from './classifier.ts'
export {
  advanceDirectorState, decideDirector, DEFAULT_DIRECTOR_THRESHOLDS, DIRECTOR_RUNGS,
  EMPTY_DIRECTOR_STATE, OFFER_PRESSURE_INTERVAL, OFFER_PRESSURE_MAX_PRESSES, worstCaseTurnsPerObjective,
} from './director.ts'
export type {
  DirectorAction, DirectorDecision, DirectorInput, DirectorRung, DirectorState,
  DirectorThresholds, RouteHealth,
} from './director.ts'
export type { PivotAssessment, PivotHandling } from './classifier.ts'
export {
  applyDialNudge, COMMIT_MIN_EVENTS, COMMIT_MIN_MARGIN, commitmentReady, DIAL_MAX, DIAL_MIN,
  ladderReady, parseEndingSignals, scoreEndings, SHORT_LADDER_MAX,
} from './endings.ts'
export type {
  EndingCandidate, EndingScores, EndingSignal, EndingSignalWhen, EndingWorld, ObjectiveLadder,
} from './endings.ts'
export { evaluatePredicate, listMilestoneAtoms } from './evaluate.ts'
export type { MilestoneAtoms, WorldFacts } from './evaluate.ts'
export {
  activeLoop, advanceBeat, completeLoop, pushLoop, resumeLoop, suspendLoop,
} from './loops.ts'
export type { LoopOpResult, LoopSeed } from './loops.ts'
export {
  canReweave, canStageOffer, MAX_OPEN_OFFERS, MAX_REWEAVES, negotiatedGold, offerBanner,
  openingTerms, parseOfferResponse, parseRewardBounds,
} from './offers.ts'
export { corpsePropText, scenePropsAt } from './props.ts'
export type { PropRow, ScenePropView } from './props.ts'
export { addressedNpcId, isStageable, npcStateOf, resolveNpcNames, stageableNpcs } from './staging.ts'
export { annotateStaleMemories } from './memory-staleness.ts'
export type { MemorySubject } from './memory-staleness.ts'
export type { NpcLiveState, NpcStageRow } from './staging.ts'
export {
  ENCOUNTER_TEMPLATES, pickTemplate, templateByKey, templateGuidance, templateMenu,
  templatesForKind, TWIST_AXES,
} from './templates-encounter.ts'
export type { EncounterTemplate, TemplateKind, TwistAxis } from './templates-encounter.ts'
export { intentPillar, isOffLoop, LOOP_TEMPLATES } from './templates.ts'
export type { LoopTemplate, Pillar } from './templates.ts'
export { LOOP_TYPES } from './types.ts'
export type {
  BeatStatus, CoreLoop, LoopStatus, LoopType, OfferResponseKind, OfferStatus, OfferTerms,
  RewardBounds,
} from './types.ts'
export {
  COOP_FATIGUE_STREAK, computeVarietyFlags, dominantPillar, LOOP_TYPE_WINDOW, SAME_TYPE_LIMIT,
  SPOTLIGHT_MIN_INTENTS, SPOTLIGHT_SHARE, encounterKindGuidance, varietyGuidance,
} from './variety.ts'
export type { VarietyFlags, VarietyInput } from './variety.ts'
export {
  clearDeadline, deadlinePressureLines, dueDeadlines, markMissed, parseDeadlineRecords,
  scheduleDeadline,
} from './deadlines.ts'
export type { DeadlineRecord } from './deadlines.ts'
