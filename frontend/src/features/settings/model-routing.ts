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
  narrator: 'z-ai/glm-5.2',
  npc_agent: 'z-ai/glm-5.2',
  adjudicator: 'google/gemini-2.5-flash-lite',
  loop_classifier: 'google/gemini-2.5-flash-lite',
  encounter_designer: 'google/gemini-2.5-flash-lite',
  npc_tactician: 'google/gemini-2.5-flash-lite',
  story_director: 'z-ai/glm-5.2',
  ingredient_generator: 'z-ai/glm-5.2',
  beat_planner: 'google/gemini-2.5-flash-lite',
  hook_weaver: 'z-ai/glm-5.2',
  meta_loop_steward: 'z-ai/glm-5.2',
  consistency_checker: 'google/gemini-2.5-flash-lite',
  summarizer: 'google/gemini-2.5-flash-lite',
  user_direct: 'google/gemini-2.5-flash-lite',
}

// Two models, on purpose: every role is either "code validates this" (flash-lite) or "nothing
// downstream can fix this" (glm-5.2). This is the picker's menu, not a whitelist - a stored
// override naming another model still resolves.
export const CURATED_TEXT_MODELS = [
  'google/gemini-2.5-flash-lite',
  'z-ai/glm-5.2',
] as const

export function isAgentRole(value: string): value is AgentRole {
  return value in SYSTEM_DEFAULT_MODEL_MAP
}

/** User's model_map entry wins; falls back to the MAIN-SPEC SS4.7 system default for the role. */
export function resolveModel(agentRole: AgentRole, modelMap: Record<string, string>): string {
  return modelMap[agentRole] ?? SYSTEM_DEFAULT_MODEL_MAP[agentRole]
}
