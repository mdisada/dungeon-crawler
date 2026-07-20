// Every PAID integration test pins ALL agent roles to one cheap model so a run's cost is
// predictable and a model's quirks can't masquerade as a system bug (2026-07-21, user's call).
// This is TEST-ONLY: it writes user_settings.model_map for the throwaway user, which
// resolveModel() honours over SYSTEM_DEFAULT_MODEL_MAP. Production routing is untouched.
//
// Keep in sync with AgentRole in supabase/functions/_shared/model-routing.ts.
export const TEST_MODEL = 'google/gemini-2.5-flash-lite'

export const AGENT_ROLES = [
  'narrator',
  'npc_agent',
  'adjudicator',
  'loop_classifier',
  'encounter_designer',
  'npc_tactician',
  'story_director',
  'ingredient_generator',
  'beat_planner',
  'hook_weaver',
  'meta_loop_steward',
  'consistency_checker',
  'summarizer',
  'user_direct',
]

export const TEST_MODEL_MAP = Object.fromEntries(AGENT_ROLES.map((role) => [role, TEST_MODEL]))

/** Pins every agent role for `userId`. Pass the same serviceRest helper the suite already uses. */
export async function pinTestModels(serviceRest, userId) {
  await serviceRest('POST', 'user_settings?on_conflict=user_id', {
    user_id: userId, provider: 'openrouter', model_map: TEST_MODEL_MAP,
  }).catch(() => {})
}
