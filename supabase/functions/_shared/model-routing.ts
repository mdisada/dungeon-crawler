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
  | 'image_prompter'
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
  npc_tactician: 'google/gemini-2.5-flash-lite',
  summarizer: 'google/gemini-2.5-flash-lite',
  // Not a Story agent -- direct user-triggered calls (e.g. the Settings test box). Cheap default.
  // Primary seat: what it writes goes straight into a paid image with nothing downstream to
  // catch a bad brief - a background plate full of people is a plate you pay for twice.
  image_prompter: 'openai/gpt-5.6-luna',
  user_direct: 'google/gemini-2.5-flash-lite',

  // --- Primary seat: openai/gpt-5.6-luna ($0.100/$0.600, 1.05M ctx) --------------------------
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
  // PROMOTED 2026-07-31, on the only measurement in this table taken against a DELETION.
  //
  // This role looks like cheap-tier work - it reads and reports, and its stage-7 output is warnings
  // a person triages. But at guide time it also runs the stage-6 GROUP CLASSIFIER, which DELETES
  // npc rows: the one irreversible model decision in the pipeline, with no later stage able to put
  // a row back. Measured on the cast of a guide it destroyed (Batman [alive], Dr. Jonathan Crane
  // [absent]), three runs each:
  //
  //   google/gemini-2.5-flash-lite   called Batman a group 3/3 (once Crane too)
  //   openai/gpt-5.6-luna            0/3
  //   z-ai/glm-5.2                   0/3
  //
  // All three caught a genuine group ("The Gotham City Watch") when one was in the list, so the
  // cheap seat was not being cautious - it was wrong about named individuals. The blast-radius
  // rule this table is built on says an irreversible call belongs on the primary seat, and this is
  // the role that proves it: one bad classification cost a whole generation.
  consistency_checker: 'openai/gpt-5.6-luna',
  // PROMOTED 2026-07-31 (owner's call), reversing the 2026-07-26 demotion and the 2026-07-29 guide
  // exemption. Both rested on facts about models that no longer sit in these seats.
  //
  // `beat_planner` authors a chapter's playable scenes. Measured on one objective, seven runs each,
  // with the route ceiling stated in the prompt (it was not, and that was worth finding):
  //
  //   google/gemini-2.5-flash-lite   4.1-4.4s   ~1150 tok   2/2 parsed   kinds: skill/skill/skill
  //   openai/gpt-5.6-luna            7.5-10.2s  ~1160 tok   7/7 parsed   puzzle in 7/7, combat 5/7
  //
  // 8.5s average against a 150s invocation, so four objectives cost ~34s - nothing like the 83s
  // that got this role exempted when glm-5.2 held the seat. What the money buys is scene VARIETY:
  // the cheap seat wrote three skill challenges for an objective where luna wrote a puzzle every
  // time. "Menu-picking work" was the demotion's argument, and it is exactly where a stronger
  // writer shows: the menu is the same, the choices are not.
  beat_planner: 'openai/gpt-5.6-luna',
  // `encounter_designer` rides along on the owner's call. Its exemption shared beat_planner's dead
  // premises, but note honestly: it has NOT been measured on this seat. The budget arithmetic that
  // guards it is code, not model, so the downside is spend and latency rather than a bad fight.
  encounter_designer: 'openai/gpt-5.6-luna',
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
/**
 * DERIVED, not named (2026-07-31). This was the literal string `z-ai/glm-5.2`, and when the primary
 * seat moved to gpt-5.6-luna it became the last place in the codebase still pointing at the old
 * occupant - so every guide role WITHOUT a user pin kept resolving to a model no seat named any
 * more. Reading it off the flagship primary role means a future seat change moves this with it,
 * and there is no third place to forget.
 *
 * What does NOT come along: glm-5.2's guide-time measurements. Stage 4 at 94s and 5,736 tokens,
 * $0.711/$2.235 per M, the 4.4x-slower-per-token figure behind the exemptions below - all of that
 * described one model. gpt-5.6-luna is unmeasured at guide time; treat the pipeline's timings and
 * spend as unknown until a run says otherwise. Its output price is 3.7x lower on paper, which is a
 * reason to expect cheaper guides and no reason at all to expect better ones.
 */
const GUIDE_MODEL = SYSTEM_DEFAULT_MODEL_MAP.story_director

/**
 * RETIRED 2026-07-31 - kept empty rather than deleted, because the mechanism is one line and the
 * history is the point.
 *
 * It held `beat_planner` and `encounter_designer`, exempted 2026-07-29 on this measurement:
 *
 *   google/gemini-2.5-flash-lite   4.7s   1006 output tokens   213 tok/s   (11 calls)
 *   z-ai/glm-5.2                  83.3s   4000 output tokens    48 tok/s
 *
 * glm-5.2 landed exactly on the 4000-token cap, so its reply was truncated, stage 5 retried inside
 * the same invocation, and the ~150s wall clock died four times running. `encounter_designer`
 * showed the same shape at 33-87s across six calls. The exemption is what kept guides finishing.
 *
 * Every premise of that has since gone. Stage 5 authors one call per OBJECTIVE (2026-07-29) instead
 * of one per chapter, the seat holds gpt-5.6-luna rather than glm-5.2, and re-measuring the same
 * role on the same objective gives 7.5-10.2s and 7/7 parses. An exemption argued from a truncation
 * that cannot recur, against a model no longer in the seat, is not evidence - it is residue.
 *
 * If a future seat is slow again, this is where that goes, with its numbers.
 */
const GUIDE_MODEL_EXEMPT: ReadonlySet<AgentRole> = new Set<AgentRole>([])

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
