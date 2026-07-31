// Plain TypeScript, no Deno-specific APIs -- kept import-free and side-effect-free so this exact
// logic can be exercised by any test runner (see frontend/src/features/settings, which mirrors
// these defaults for the Settings UI and unit-tests the resolution rule with Vitest).
//
// Per-agent-role default model routing (MAIN-SPEC.md SS4.7). User overrides live in
// user_settings.model_map (jsonb: { [agentRole]: openRouterModelSlug }) and always win.

export type AgentRole =
  | 'narrator'
  | 'npc_agent'
  | 'adjudicator'
  | 'loop_classifier'
  | 'encounter_designer'
  | 'npc_tactician'
  | 'story_director'
  | 'ingredient_generator'
  | 'beat_planner'
  | 'hook_weaver'
  | 'meta_loop_steward'
  | 'consistency_checker'
  | 'summarizer'
  | 'user_direct'

/**
 * Tiering principle (2026-07-26, measured): spend on BLAST RADIUS, not on volume.
 *
 * A guide's real cost sat on output tokens from `deepseek-v4-pro`, while the biggest consumer of
 * INPUT tokens (`consistency_checker`, 41% of them) cost 7% of the money. So the rule is not
 * "important vs unimportant" but **how much surrounding code validates the answer**:
 *
 * - The strongest model goes where output is open-ended, hard to validate, and inherited by
 *   everything downstream - the Story Director (premise, arc, objectives, endings). Called ~5
 *   times per guide; a weak premise cannot be linted back into a good one.
 * - Cheap models go where code owns the structure and a wrong answer is caught for free: the
 *   Beat Planner now authors story nodes whose success atoms are DERIVED, whose transitions are
 *   coerced, whose NPCs are enum'd, and which the stage-8 reachability gate must pass. That is a
 *   menu-picking job, and it was the second-most expensive call in the pipeline on a pro model.
 * - The cheap tier also REPAIRS the expensive tier: the stage-7 consistency pass reads what the
 *   Story Director wrote and rewrites contradictions, at 1/8th the price per token.
 */
export const SYSTEM_DEFAULT_MODEL_MAP: Record<AgentRole, string> = {
  // --- Cheap tier: gemini-2.5-flash-lite ($0.100/$0.400 per M, 1M context) --------------------
  // Everything whose output is consumed by CODE, not read by a person.
  //
  // NOTE the family naming trap: `gemini-2.5-flash` (no -lite) is $0.300/$2.500 - a HIGHER output
  // price than the premium seat below. "flash" is not a synonym for cheap on OpenRouter.
  adjudicator: 'google/gemini-2.5-flash-lite',
  loop_classifier: 'google/gemini-2.5-flash-lite',
  encounter_designer: 'google/gemini-2.5-flash-lite',
  npc_tactician: 'google/gemini-2.5-flash-lite',
  // Story-node authoring: schema-constrained, code-derived outcomes, lint-gated. Demoted from a
  // pro model 2026-07-26 - it was ~22% of guide cost for what is menu-picking work, and flash-lite
  // parsed the node schema first try with no retry.
  beat_planner: 'google/gemini-2.5-flash-lite',
  // PLAY-side only, and the distinction matters: at guide time this same role also runs the stage-6
  // GROUP CLASSIFIER, which DELETES npc rows - the one irreversible model decision in the pipeline.
  // Measured 2026-07-31 on the cast of a guide it broke (Batman [alive], Dr. Jonathan Crane
  // [absent]), three runs each:
  //
  //   google/gemini-2.5-flash-lite   called Batman a group 3/3 (once Crane too)
  //   openai/gpt-5.6-luna            0/3
  //   z-ai/glm-5.2                   0/3
  //
  // All three caught a genuine group ("The Gotham City Watch") when one was present, so the cheap
  // seat is not being careful - it is wrong. The guide phase already routes this role to
  // GUIDE_MODEL for exactly this reason; a user model_map pin is what puts it back on the cheap
  // tier, and doing that costs a deleted character.
  consistency_checker: 'google/gemini-2.5-flash-lite',
  summarizer: 'google/gemini-2.5-flash-lite',
  // Not a Story agent -- direct user-triggered calls (e.g. the Settings test box). Cheap default.
  user_direct: 'google/gemini-2.5-flash-lite',

  // --- Premium tier: z-ai/glm-5.2 ($0.711/$2.235, 1M ctx) ------------------------------------
  // Output no code can validate: either a person READS it directly, or everything downstream
  // inherits it.
  //
  // Narration was cheap until an A/B settled it (2026-07-26, same plot + same fixes, only the
  // narrator swapped): flash-lite ignored the contract's "no formulaic closing line" ban 3 times
  // and wrote 38 thin beats; glm-5.2 broke it 0 times in 23 denser ones, held per-character
  // continuity across beats, and stopped falsely declaring quests resolved. Progression was
  // identical (1 objective each), so this buys prose, not pacing. ~+$0.045 per 26-turn session.
  //
  // SEAT MOVED to openai/gpt-5.6-luna (2026-07-31, owner's choice). Note what that A/B does and
  // does not cover: it establishes that this seat needs a strong model, NOT that any particular
  // strong model fills it. gpt-5.6-luna has not been measured here - no A/B, no per-token cost
  // recorded, no read of its prose against the narrator contract. Treat the quality and spend of
  // the primary seat as UNKNOWN until a run says otherwise.
  narrator: 'openai/gpt-5.6-luna',
  npc_agent: 'openai/gpt-5.6-luna',
  story_director: 'openai/gpt-5.6-luna',
  // Not in MAIN-SPEC SS4.7's table (a gap - the Ingredient Generator agent exists in SS4 but was
  // never given a row); grouped with the other guide-generation creative roles. Added Phase 3b.
  // Authors the entire cast and the clue pool: one call per chapter, enormous blast radius.
  ingredient_generator: 'openai/gpt-5.6-luna',
  // Hooks, the entry contract, and the personal-stake slots - the connective tissue the whole
  // guide hangs off. Two calls per guide.
  hook_weaver: 'openai/gpt-5.6-luna',
  // Antagonist turns and, critically, the CLIMAX author - the prose the player reads as the
  // ending. Rare calls, and the last thing anyone experiences.
  meta_loop_steward: 'openai/gpt-5.6-luna',
}

/**
 * Two SEATS, on purpose (2026-07-26) - the menu may hold more entries than seats. Every role is
 * either "code validates this" (secondary) or "nothing downstream can fix this" (primary); a middle
 * TIER only blurred that line, but offering more than two CHOICES does not, because which model
 * occupies a seat moves with price and availability. An override stored in `user_settings.model_map`
 * still resolves even if it names a model absent here - this list is the picker's menu, not a
 * whitelist.
 */
export const CURATED_TEXT_MODELS = [
  'google/gemini-2.5-flash-lite',
  'z-ai/glm-5.2',
  'openai/gpt-5.6-luna',
] as const

export function isAgentRole(value: string): value is AgentRole {
  return value in SYSTEM_DEFAULT_MODEL_MAP
}

/**
 * Which side of the app is asking (2026-07-29). Guide generation and live play share agent ROLES
 * but not priorities, and until now they shared the tier table too - so `beat_planner`, demoted to
 * flash-lite on cost grounds, authored the whole story graph on the cheap tier.
 */
export type ResolvePhase = 'play' | 'guide'

/**
 * Guide-time calls go to the strong model (owner direction, 2026-07-29) - except the roles in
 * GUIDE_MODEL_EXEMPT below, which measurement removed from it the same day.
 *
 * The guide carries the coherence burden BY DESIGN: the plot is prewritten precisely so live play
 * has less room to drift. A weak premise or a thin cast cannot be linted back into a good one - it
 * is inherited by every turn of every session ever played on that guide. And guides are generated
 * once and reused, so the cost amortises over whole playthroughs in a way a per-turn call never
 * does.
 *
 * A user's explicit `model_map` entry still wins, per the contract at the top of this file - that
 * is what lets the lab pin an entire run to one model. Note the consequence: `pin_models: true`
 * pins the GUIDE too, so a lab run that wants a real guide must use a PARTIAL model_map naming
 * only the play-side roles.
 */
const GUIDE_MODEL = 'z-ai/glm-5.2'

/**
 * Guide-time roles the strong model is NOT worth paying for, measured 2026-07-29.
 *
 * `beat_planner` authors a whole chapter's node graph in ONE call. Same role, same task:
 *
 *   google/gemini-2.5-flash-lite   4.7s   1006 output tokens   213 tok/s   (11 calls)
 *   z-ai/glm-5.2                  83.3s   4000 output tokens    48 tok/s
 *
 * 4.4x slower per token AND four times the output - landing exactly on the 4000-token cap, so the
 * reply was TRUNCATED. Stage 5 then retried inside the same invocation and blew the edge function's
 * ~150s wall clock four times running, taking the whole guide down with it. `encounter_designer`
 * showed the same shape at 33-87s across six calls.
 *
 * So the promotion bought a cut-off answer and a failed generation, not quality. And these are
 * precisely the roles the 2026-07-26 tiering demoted for being schema-constrained, lint-gated
 * menu-picking - an argument that is STRONGER after 2026-07-29, because outcomes, transitions and
 * `establishes` are now all code-derived and the model only writes fiction and picks from closed
 * menus. The roles that actually shape the story - story_director, ingredient_generator,
 * hook_weaver - keep the strong model.
 *
 * The real fix for stage 5 is to author one call per OBJECTIVE rather than per chapter; the
 * truncation will bite on any model as guides grow. Until then this exemption is what keeps guide
 * generation finishing at all.
 */
const GUIDE_MODEL_EXEMPT: ReadonlySet<AgentRole> = new Set<AgentRole>([
  'beat_planner',
  'encounter_designer',
])

/** User's model_map entry wins; then the phase default; then the MAIN-SPEC SS4.7 role default. */
export function resolveModel(
  agentRole: AgentRole,
  modelMap: Record<string, string>,
  phase: ResolvePhase = 'play',
): string {
  if (modelMap[agentRole]) return modelMap[agentRole]
  if (phase === 'guide' && !GUIDE_MODEL_EXEMPT.has(agentRole)) return GUIDE_MODEL
  return SYSTEM_DEFAULT_MODEL_MAP[agentRole]
}
