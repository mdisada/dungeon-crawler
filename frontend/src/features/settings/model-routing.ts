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

export const SYSTEM_DEFAULT_MODEL_MAP: Record<AgentRole, string> = {
  narrator: 'xiaomi/mimo-v2.5',
  npc_agent: 'xiaomi/mimo-v2.5',
  adjudicator: 'deepseek/deepseek-v4-flash',
  loop_classifier: 'deepseek/deepseek-v4-flash',
  encounter_designer: 'deepseek/deepseek-v4-flash',
  npc_tactician: 'deepseek/deepseek-v4-flash',
  story_director: 'deepseek/deepseek-v4-pro',
  ingredient_generator: 'deepseek/deepseek-v4-pro',
  beat_planner: 'deepseek/deepseek-v4-pro',
  hook_weaver: 'deepseek/deepseek-v4-pro',
  meta_loop_steward: 'deepseek/deepseek-v4-pro',
  consistency_checker: 'google/gemini-2.5-flash-lite',
  summarizer: 'google/gemini-2.5-flash-lite',
  user_direct: 'google/gemini-2.5-flash-lite',
}

export const CURATED_TEXT_MODELS = [
  'xiaomi/mimo-v2.5',
  'deepseek/deepseek-v4-flash',
  'deepseek/deepseek-v4-pro',
  'google/gemini-2.5-flash-lite',
  'mistralai/mistral-nemo',
] as const

export function isAgentRole(value: string): value is AgentRole {
  return value in SYSTEM_DEFAULT_MODEL_MAP
}

/** User's model_map entry wins; falls back to the MAIN-SPEC SS4.7 system default for the role. */
export function resolveModel(agentRole: AgentRole, modelMap: Record<string, string>): string {
  return modelMap[agentRole] ?? SYSTEM_DEFAULT_MODEL_MAP[agentRole]
}
