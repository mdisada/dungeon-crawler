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

export const SYSTEM_DEFAULT_MODEL_MAP: Record<AgentRole, string> = {
  narrator: 'xiaomi/mimo-v2.5',
  npc_agent: 'xiaomi/mimo-v2.5',
  adjudicator: 'deepseek/deepseek-v4-flash',
  loop_classifier: 'deepseek/deepseek-v4-flash',
  encounter_designer: 'deepseek/deepseek-v4-flash',
  npc_tactician: 'deepseek/deepseek-v4-flash',
  story_director: 'deepseek/deepseek-v4-pro',
  // Not in MAIN-SPEC SS4.7's table (a gap - the Ingredient Generator agent exists in SS4 but was
  // never given a row); grouped with the other guide-generation creative roles. Added Phase 3b.
  ingredient_generator: 'deepseek/deepseek-v4-pro',
  beat_planner: 'deepseek/deepseek-v4-pro',
  hook_weaver: 'deepseek/deepseek-v4-pro',
  meta_loop_steward: 'deepseek/deepseek-v4-pro',
  consistency_checker: 'google/gemini-2.5-flash-lite',
  summarizer: 'google/gemini-2.5-flash-lite',
  // Not a Story agent -- direct user-triggered calls (e.g. the Settings test box). Cheap default.
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
