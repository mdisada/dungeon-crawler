// Milestone vocabulary + validated application (F14, extracted from scene-director.ts in
// encounter-states Slice 6 to keep the import graph acyclic). The LLM side can only ever
// claim milestones from the authored vocabulary - it cannot invent story progress.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { listMilestoneAtoms } from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

/**
 * The authored milestone vocabulary: predicate atoms from the active objective's completion
 * predicates plus the open beat's exit conditions.
 */
export async function milestoneVocabulary(
  service: SupabaseClient,
  adventureId: string,
): Promise<{ flags: string[]; events: string[]; facts: string[] }> {
  const flags = new Set<string>()
  const events = new Set<string>()
  const facts = new Set<string>()
  const add = (predicate: unknown) => {
    const atoms = listMilestoneAtoms(predicate)
    atoms.flags.forEach((f) => flags.add(f))
    atoms.events.forEach((e) => events.add(e))
    atoms.facts.forEach((f) => facts.add(f))
  }
  const { data: stateRow } = await service
    .from('adventure_state')
    .select('state')
    .eq('adventure_id', adventureId)
    .maybeSingle()
  const currentId = (stateRow?.state as { objectives?: { currentId?: string | null } } | null)?.objectives?.currentId ?? null
  if (currentId) {
    const { data: objective } = await service
      .from('objectives')
      .select('completion_predicates')
      .eq('id', currentId)
      .maybeSingle()
    add(objective?.completion_predicates ?? null)
  }
  const { data: loops } = await service
    .from('core_loops')
    .select('current_beat_id')
    .eq('adventure_id', adventureId)
    .eq('status', 'active')
    .limit(1)
  const beatId = (loops ?? [])[0]?.current_beat_id as string | undefined
  if (beatId) {
    const { data: beat } = await service.from('beats').select('exit_conditions').eq('id', beatId).maybeSingle()
    add(beat?.exit_conditions ?? null)
  }
  return { flags: [...flags], events: [...events], facts: [...facts] }
}

/**
 * Validates proposed milestones against the authored vocabulary and applies the new ones:
 * flags/boolean facts get set, event milestones log their exact story marker. Already-satisfied
 * milestones are skipped so re-claims stay silent. Returns the milestones actually applied.
 */
export async function applyMilestones(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  proposed: string[],
  source: string,
): Promise<string[]> {
  const vocab = await milestoneVocabulary(service, env.adventureId)
  const flagByLower = new Map(vocab.flags.map((f) => [f.toLowerCase(), f]))
  const eventByLower = new Map(vocab.events.map((e) => [e.toLowerCase(), e]))
  const factByLower = new Map(vocab.facts.map((f) => [f.toLowerCase(), f]))
  const state = (await loadState(service, env.adventureId)).state
  const flags = state.dm?.facts.flags ?? {}
  const world = state.dm?.facts.world ?? {}

  const applied: string[] = []
  for (const raw of proposed) {
    const key = raw.toLowerCase().trim()
    const flag = flagByLower.get(key)
    const eventTag = eventByLower.get(key)
    const fact = factByLower.get(key)
    if (flag || fact) {
      // The same atom name can be authored as a beat-exit FLAG and an objective FACT (seen
      // in the story sim: outcome maps fired into flags while the objective read facts).
      // Set every namespace the name exists in - progression atoms are idempotent booleans.
      const needsFlag = flag !== undefined && flags[flag] !== true
      const needsFact = fact !== undefined && world[fact] !== true
      if (!needsFlag && !needsFact) continue
      await commitDiffs(service, env.adventureId, () => [
        {
          domain: 'dm',
          patch: {
            facts: {
              ...(needsFlag ? { flags: { [flag!]: true } } : {}),
              ...(needsFact ? { world: { [fact!]: true } } : {}),
            },
          },
        },
      ])
      await logEvent(service, env.adventureId, sessionId, 'milestone_reached', {
        milestone: flag ?? fact!, kind: flag ? 'flag' : 'fact', source,
      })
      applied.push(flag ?? fact!)
    } else if (eventTag) {
      const { data: existing } = await service
        .from('event_log')
        .select('id')
        .eq('adventure_id', env.adventureId)
        .eq('type', 'story_event')
        .eq('payload->>tag', eventTag)
        .limit(1)
      if ((existing ?? []).length > 0) continue
      await logEvent(service, env.adventureId, sessionId, 'story_event', { tag: eventTag, source: 'milestone' })
      await logEvent(service, env.adventureId, sessionId, 'milestone_reached', { milestone: eventTag, kind: 'event', source })
      applied.push(eventTag)
    } else {
      await logEvent(service, env.adventureId, sessionId, 'scene_effect_rejected', { effect: 'milestone', proposed: raw })
    }
  }
  return applied
}
