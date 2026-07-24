// Milestone vocabulary + validated application (F14, extracted from scene-director.ts in
// encounter-states Slice 6 to keep the import graph acyclic). The LLM side can only ever
// claim milestones from the authored vocabulary - it cannot invent story progress.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import {
  canonicalizeAtomSlug, listMilestoneAtoms, resolveAtomText, suggestAtomTexts,
} from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

/**
 * Atom-registry rollout switch (overhaul Phase 1). false = SHADOW: proposals that miss the
 * exact vocabulary but resolve through canonicalization (case/punctuation/apostrophes) or a
 * conservative near-miss (word reorder, <=2 edits) are LOGGED as `atom_registry_shadow` and
 * still rejected, exactly as before. Flip to true once a paid lab sweep shows every shadow
 * repair is one we'd want: then those proposals apply and log `milestone_canonicalized`.
 * The observed drift class this exists for: "found_expedition_journal" proposed against
 * authored "lost_expedition_journal_found" must STILL reject (different meaning) while
 * "ignored_scholar's_warning" vs "ignored_scholars_warning" must repair (same meaning).
 */
export const ATOM_REGISTRY_ENFORCES = false

/**
 * The authored milestone vocabulary: predicate atoms from the active objective's completion
 * predicates plus the open beat's exit conditions.
 */
export async function milestoneVocabulary(
  service: SupabaseClient,
  adventureId: string,
): Promise<{
  flags: string[]
  events: string[]
  facts: string[]
  /** What the current objective is FOR - the atoms alone are identifiers, not meaning. */
  objective: { title: string; hiddenDescription: string } | null
}> {
  const flags = new Set<string>()
  const events = new Set<string>()
  const facts = new Set<string>()
  let objective: { title: string; hiddenDescription: string } | null = null
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
    // Current objective AND the one after it. Progression used to be strictly sequential: the
    // vocabulary held only the current objective, so a party that did the NEXT step first - which
    // is what parties do whenever objectives are not a straight line - accomplished something the
    // Archivist had no word for, and the current objective sat unfinished forever (court: 0
    // objectives in 5 of 5 live runs). Lookahead is 1, not all: claiming a climax atom in scene
    // one would end the adventure early, and one step of slack is what the fiction actually takes.
    // Nothing completes out of order - evaluation still only ever fires on the current objective,
    // so a lookahead atom just waits, already true, for its turn to come round.
    const [{ data: chapters }, { data: objectiveRows }] = await Promise.all([
      service.from('chapters').select('id, index').eq('adventure_id', adventureId).order('index'),
      service.from('objectives').select('id, chapter_id, index, title, hidden_description, completion_predicates').eq('adventure_id', adventureId),
    ])
    const chapterOrder = new Map(((chapters ?? []) as { id: string; index: number }[]).map((c) => [c.id, c.index]))
    const ordered = ((objectiveRows ?? []) as {
      id: string; chapter_id: string; index: number; title: string | null
      hidden_description: string | null; completion_predicates: unknown
    }[]).sort((a, b) => {
      const byChapter = (chapterOrder.get(a.chapter_id) ?? 0) - (chapterOrder.get(b.chapter_id) ?? 0)
      return byChapter !== 0 ? byChapter : a.index - b.index
    })
    const at = ordered.findIndex((o) => o.id === currentId)
    if (at >= 0) {
      add(ordered[at].completion_predicates)
      objective = {
        title: ordered[at].title ?? '',
        hiddenDescription: ordered[at].hidden_description ?? '',
      }
      if (ordered[at + 1]) add(ordered[at + 1].completion_predicates)
    }
  }
  // EVERY beat this adventure has authored, not just the open one. The ledger runs at phase
  // exits - precisely when a beat closes and the next opens - so a beat atom the Archivist was
  // legitimately shown had already left the vocabulary by the time applyMilestones rebuilt it,
  // and the claim was dropped as unauthored ("bram_escaped_enforcers", live 2026-07-21). Roughly
  // half of all correct observations died in that window. An atom authored for this adventure is
  // legitimate vocabulary for the rest of it.
  const { data: loops } = await service
    .from('core_loops')
    .select('id')
    .eq('adventure_id', adventureId)
  const loopIds = ((loops ?? []) as { id: string }[]).map((l) => l.id)
  if (loopIds.length > 0) {
    const { data: beats } = await service
      .from('beats')
      .select('exit_conditions')
      .in('core_loop_id', loopIds)
    for (const beat of (beats ?? []) as { exit_conditions: unknown }[]) add(beat.exit_conditions)
  }
  return { flags: [...flags], events: [...events], facts: [...facts], objective }
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
  const authoredAll = [...vocab.flags, ...vocab.events, ...vocab.facts]
  const state = (await loadState(service, env.adventureId)).state
  const flags = state.dm?.facts.flags ?? {}
  const world = state.dm?.facts.world ?? {}

  const applied: string[] = []
  for (const raw of proposed) {
    let key = raw.toLowerCase().trim()
    // Canonical resolution (Phase 1): a proposal the exact-lowercase window misses may still
    // be a case/punctuation/reorder variant of an authored atom. Shadow-first - see the flag.
    if (!flagByLower.has(key) && !eventByLower.has(key) && !factByLower.has(key)) {
      const resolution = resolveAtomText(raw, authoredAll)
      if (resolution.ok) {
        if (ATOM_REGISTRY_ENFORCES) {
          await logEvent(service, env.adventureId, sessionId, 'milestone_canonicalized', {
            proposed: raw, resolved: resolution.text, via: resolution.via, source,
          })
          key = resolution.text.toLowerCase()
        } else {
          await logEvent(service, env.adventureId, sessionId, 'atom_registry_shadow', {
            proposed: raw, resolved: resolution.text, via: resolution.via, source, would: 'repair',
          })
        }
      }
    }
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
      // Suggestions turn a silent drop into a debuggable one - the lab reads these to tell a
      // paraphrase from a near-miss worth adding to the canonicalizer's test suite.
      await logEvent(service, env.adventureId, sessionId, 'scene_effect_rejected', {
        effect: 'milestone', proposed: raw,
        suggestions: suggestAtomTexts(canonicalizeAtomSlug(raw), authoredAll),
      })
    }
  }
  return applied
}
