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

/**
 * Pins every agent role for `userId`, then VERIFIES it landed.
 *
 * The previous version POSTed with on_conflict but no merge-duplicates header and swallowed the
 * result with .catch(() => {}). A user_settings row already exists by the time we get here, so
 * every pin silently conflicted and left model_map at its '{}' default - three "pinned" paid
 * runs actually used the system defaults (deepseek-v4-pro for the guide roles). Never swallow
 * the write, and always read it back.
 */
export async function pinTestModels(serviceRest, userId) {
  const patched = await serviceRest(
    'PATCH', `user_settings?user_id=eq.${userId}`,
    { provider: 'openrouter', model_map: TEST_MODEL_MAP },
  )
  if (!Array.isArray(patched) || patched.length === 0) {
    await serviceRest('POST', 'user_settings', {
      user_id: userId, provider: 'openrouter', model_map: TEST_MODEL_MAP,
    })
  }
  const [row] = await serviceRest('GET', `user_settings?user_id=eq.${userId}&select=model_map`)
  const pinned = Object.values(row?.model_map ?? {})
  if (pinned.length === 0 || pinned.some((m) => m !== TEST_MODEL)) {
    throw new Error(`model pin failed - model_map is ${JSON.stringify(row?.model_map)}`)
  }
}
