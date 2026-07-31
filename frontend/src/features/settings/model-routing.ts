// Mirrors supabase/functions/_shared/model-routing.ts. Duplicated (not imported) because the
// edge function bundle can't reach outside supabase/functions -- this copy exists so the
// Settings UI can display "what model will actually be used" (user override, else system
// default) without a round trip, and so the resolution rule has frontend test coverage
// (model-routing.test.ts) since this project doesn't run Deno tests locally (see docs/DECISIONS.md).

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

export const AGENT_ROLE_LABELS: Record<AgentRole, string> = {
  narrator: 'Narrator',
  npc_agent: 'NPC Agent',
  adjudicator: 'Adjudicator',
  loop_classifier: 'Loop Classifier',
  encounter_designer: 'Encounter Designer',
  npc_tactician: 'NPC Tactician',
  story_director: 'Story Director',
  ingredient_generator: 'Ingredient Generator',
  beat_planner: 'Beat Planner',
  hook_weaver: 'Hook Weaver',
  meta_loop_steward: 'Meta Loop Steward',
  consistency_checker: 'Consistency Checker',
  summarizer: 'Summarizer',
  user_direct: 'Direct requests (e.g. this test box)',
}

// Tiering principle (2026-07-26): spend on BLAST RADIUS, not volume. The strongest model sits
// where output is open-ended and inherited by everything downstream (Story Director); cheap models
// sit where surrounding code validates the answer (node authoring is schema-constrained and
// lint-gated) or where volume is high and quality is judged live (narration).
// NOTE: `gemini-2.5-flash` (no -lite) is NOT the cheap one - $0.300/$2.500 per M, a higher output
// price than the premium glm-5.2 seat. The cheap tier is flash-LITE at $0.100/$0.400.
export const SYSTEM_DEFAULT_MODEL_MAP: Record<AgentRole, string> = {
  narrator: 'openai/gpt-5.6-luna',
  npc_agent: 'openai/gpt-5.6-luna',
  adjudicator: 'google/gemini-2.5-flash-lite',
  loop_classifier: 'google/gemini-2.5-flash-lite',
  encounter_designer: 'google/gemini-2.5-flash-lite',
  npc_tactician: 'google/gemini-2.5-flash-lite',
  story_director: 'openai/gpt-5.6-luna',
  ingredient_generator: 'openai/gpt-5.6-luna',
  beat_planner: 'google/gemini-2.5-flash-lite',
  hook_weaver: 'openai/gpt-5.6-luna',
  meta_loop_steward: 'openai/gpt-5.6-luna',
  // Primary seat since 2026-07-31: at guide time this role also runs the stage-6 group classifier,
  // which DELETES npc rows - the one irreversible model call in the pipeline. Measured on a cast it
  // destroyed, three runs each: flash-lite called a named individual a group 3/3, gpt-5.6-luna and
  // glm-5.2 0/3, and all three caught a real group when one was present. See the edge copy.
  consistency_checker: 'openai/gpt-5.6-luna',
  summarizer: 'google/gemini-2.5-flash-lite',
  user_direct: 'google/gemini-2.5-flash-lite',
}

// Two SEATS, on purpose - the menu may hold more entries than that. Every role is either "code
// validates this" (secondary) or "nothing downstream can fix this" (primary); which model occupies
// each seat is a choice that moves with price and availability. This is the picker's menu, not a
// whitelist - a stored override naming a model absent here still resolves.
export const CURATED_TEXT_MODELS = [
  'google/gemini-2.5-flash-lite',
  'z-ai/glm-5.2',
  'openai/gpt-5.6-luna',
] as const

/**
 * The two seats, named. `CURATED_TEXT_MODELS` is the picker's menu; these say which seat each
 * entry occupies, so the tier of a role can be DERIVED from the default map rather than tracked
 * in a second list that would drift the first time a role changed tier.
 */
export const PRIMARY_MODEL = 'openai/gpt-5.6-luna'
export const SECONDARY_MODEL = 'google/gemini-2.5-flash-lite'

export type ModelTier = 'primary' | 'secondary'

/**
 * Which seat a role sits in, read off its system default. Primary is "nothing downstream can fix
 * this" (open-ended output a person reads, or that everything inherits); secondary is "code
 * validates this". That split is the architecture - see the tiering note above - so the settings
 * UI offers two choices rather than fourteen.
 */
export function tierOfRole(role: AgentRole): ModelTier {
  return SYSTEM_DEFAULT_MODEL_MAP[role] === PRIMARY_MODEL ? 'primary' : 'secondary'
}

export const ROLES_BY_TIER: Record<ModelTier, AgentRole[]> = {
  primary: (Object.keys(SYSTEM_DEFAULT_MODEL_MAP) as AgentRole[]).filter((r) => tierOfRole(r) === 'primary'),
  secondary: (Object.keys(SYSTEM_DEFAULT_MODEL_MAP) as AgentRole[]).filter((r) => tierOfRole(r) === 'secondary'),
}

/**
 * Two choices -> the full per-role map that gets stored.
 *
 * Expanding here rather than teaching the resolver about tiers is deliberate: `resolveModel` and
 * every stored `user_settings.model_map` keep working untouched, so this is a UI change with no
 * backend or migration behind it.
 */
export function expandTiers(primary: string, secondary: string): Record<string, string> {
  const map: Record<string, string> = {}
  for (const role of Object.keys(SYSTEM_DEFAULT_MODEL_MAP) as AgentRole[]) {
    map[role] = tierOfRole(role) === 'primary' ? primary : secondary
  }
  return map
}

/**
 * Read two choices back out of a stored map.
 *
 * `custom` is true when the map cannot be expressed as two seats - a per-role override from the
 * old fourteen-row UI, or a hand-edited row. The caller must SAY so before overwriting, because
 * collapsing a setting into a simpler one silently discards whatever it could express and the
 * user cannot get it back.
 */
export function tiersFromMap(
  modelMap: Record<string, string>,
): { primary: string; secondary: string; custom: boolean } {
  const roles = Object.keys(SYSTEM_DEFAULT_MODEL_MAP) as AgentRole[]
  const used = (tier: ModelTier) =>
    new Set(roles.filter((r) => tierOfRole(r) === tier).map((r) => resolveModel(r, modelMap)))
  const primaryUsed = used('primary')
  const secondaryUsed = used('secondary')
  return {
    primary: primaryUsed.size === 1 ? [...primaryUsed][0] : PRIMARY_MODEL,
    secondary: secondaryUsed.size === 1 ? [...secondaryUsed][0] : SECONDARY_MODEL,
    custom: primaryUsed.size > 1 || secondaryUsed.size > 1,
  }
}

export function isAgentRole(value: string): value is AgentRole {
  return value in SYSTEM_DEFAULT_MODEL_MAP
}

/** User's model_map entry wins; falls back to the MAIN-SPEC SS4.7 system default for the role. */
export function resolveModel(agentRole: AgentRole, modelMap: Record<string, string>): string {
  return modelMap[agentRole] ?? SYSTEM_DEFAULT_MODEL_MAP[agentRole]
}
