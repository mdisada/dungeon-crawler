// The scene ledger (Archivist pass). Runs when a PHASE CLOSES - an encounter resolves, a
// social scene ends, an objective completes - and records what became true, so the engine can
// act on it. A handful of calls per session, never per turn.
//
// Why it exists: progression had exactly two writers (encounter outcome maps and the
// Adjudicator's scene_effects), so objective predicates almost never fired - a live
// multi-chapter playtest completed 1 objective in 26 turns. The ledger is a third writer, but
// a VALIDATED one: every milestone goes through applyMilestones, which drops anything outside
// the authored vocabulary. It cannot invent progress, only notice it.
//
// Assist mode never auto-applies: the ledger becomes a proposal for the DM, consistent with the
// dialogue/check review gates. A human DM's story is not advanced behind their back.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { liveLines } from '../_shared/state/index.ts'
import type { Json } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { applyDialNudges } from './dials.ts'
import { writeMemoryFragment } from './memory.ts'
import { applyNpcState } from './npc-state.ts'
import { applyMilestones, milestoneVocabulary } from './milestones.ts'
import { recordProposal } from './proposals.ts'
import { runArchivist } from './story-agents.ts'
import { compactContextDiff } from './orchestrate.ts'
import { commitDiffs, loadState, logEvent } from './util.ts'

/** How much of the closed phase the Archivist reads. */
const TRANSCRIPT_WINDOW = 18

export type LedgerPhase = 'encounter' | 'scene' | 'objective'

export interface LedgerResult {
  milestonesApplied: string[]
  digest: string
  contradictions: string[]
}

const EMPTY: LedgerResult = { milestonesApplied: [], digest: '', contradictions: [] }

/**
 * Record a closed phase. Best-effort by contract: a ledger failure must never stop a phase from
 * closing, so every path returns rather than throws.
 */
export async function recordSceneLedger(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  phase: LedgerPhase,
  label: string,
): Promise<LedgerResult> {
  try {
    const state = (await loadState(service, env.adventureId)).state
    // Only the lines belonging to the phase that just closed - anything older is already a
    // digest, and re-reading it would double-count what previous ledgers recorded.
    const transcript = liveLines(state)
      .slice(-TRANSCRIPT_WINDOW)
      .map((l) => `${l.speaker ?? 'Narrator'}: ${l.text}`)
    if (transcript.length === 0) return EMPTY

    const vocab = await milestoneVocabulary(service, env.adventureId)
    const vocabulary = [...new Set([...vocab.flags, ...vocab.events, ...vocab.facts])]

    const { data: npcRows } = await service
      .from('npcs')
      .select('id, name, initial_state')
      .eq('adventure_id', env.adventureId)
    const npcs = (npcRows ?? []) as { id: string; name: string; initial_state: string | null }[]
    const { data: adventureRow } = await service
      .from('adventures')
      .select('story_dials')
      .eq('id', env.adventureId)
      .single()
    const dials = (adventureRow?.story_dials ?? []) as { key: string; name: string; description: string }[]

    const facts = Object.entries(state.dm?.facts.world ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k)
      .concat(Object.entries(state.dm?.facts.npcStates ?? {}).map(([id, s]) => {
        const npc = npcs.find((n) => n.id === id)
        return npc ? `${npc.name} is ${s}` : ''
      }).filter(Boolean))

    const ledger = await runArchivist(env, {
      phase,
      label,
      vocabulary,
      objective: vocab.objective,
      facts,
      transcript,
      npcNames: npcs.map((n) => n.name),
      pcNames: state.players.list.map((p) => p.name),
      dials,
    })

    const gated = env.mode === 'assist'
    // applyMilestones is the validator: off-vocabulary claims are dropped, satisfied ones are
    // silent. In assist the DM approves instead - progression is theirs to grant.
    const milestonesApplied = gated || ledger.milestones.length === 0
      ? []
      : await applyMilestones(service, env, sessionId, ledger.milestones, 'scene_ledger')

    if (!gated) {
      // Verbatim-evidence gate (Phase 6). A dead/absent verdict is destructive: it removes an
      // NPC from staging and blocks their dialogue for the rest of the session, and a false
      // one is unrecoverable in play. So the Archivist must QUOTE the transcript line that
      // establishes it, and the quote has to actually be there. 'present' is restorative - it
      // can only widen what is possible - so it commits without proof, which is also what
      // keeps an arrived NPC from being locked out (live 2026-07-21).
      const haystack = transcript.join('\n').toLowerCase()
      const liveStates = state.dm?.facts.npcStates ?? {}
      for (const change of ledger.npcStates) {
        const npc = npcs.find((n) => n.name.toLowerCase() === change.name.toLowerCase())
        if (!npc) continue
        // 'alive' is restorative for someone ABSENT - they walked in, and nothing is lost by
        // believing it. For someone DEAD it is a resurrection: the single strongest claim the
        // Archivist can make, and until now the only transition that committed unchallenged.
        // Live 2026-07-23: a row flipped back to alive with no evidence field at all, which
        // re-armed the death transition and buried the same man twice in two rooms. Death is
        // irreversible unless the fiction actually says otherwise - so make it quote the line.
        const resurrection = change.state === 'alive' &&
          (liveStates[npc.id] ?? npc.initial_state ?? 'alive') === 'dead'
        if (change.state !== 'alive' || resurrection) {
          const quote = change.evidence.trim().toLowerCase()
          // Substring, not equality: the model quotes a fragment of a longer line.
          const proven = quote.length >= 12 && haystack.includes(quote)
          if (!proven) {
            await logEvent(service, env.adventureId, sessionId, 'incident', {
              kind: 'npc_state_unverified', npc_id: npc.id, name: npc.name,
              state: change.state, evidence: change.evidence.slice(0, 200),
            })
            await recordProposal(service, {
              adventureId: env.adventureId,
              sessionId,
              type: 'npc_state',
              payload: { npc_id: npc.id, name: npc.name, state: change.state, evidence: change.evidence },
              mode: 'human',
              summary: `Unverified: mark ${npc.name} ${change.state}`,
            })
            continue
          }
        }
        // Single writer for NPC state (npc-state.ts): a death also puts the BODY in the world
        // as a prop, so nothing downstream has to reason about a person-shaped dead thing.
        await applyNpcState(
          service, env, sessionId, npc, change.state, 'scene_ledger',
          change.state !== 'alive' ? change.evidence : undefined,
        )
      }
    }

    // Compaction: the closed phase's raw transcript stops being sent to agents from here on.
    // Done even when the digest is empty, so the window still advances past a dead phase.
    await commitDiffs(service, env.adventureId, (s) => [compactContextDiff(s, ledger.digest)])

    // Dial movement rides this same read - it used to be a second summarizer call over the
    // same transcript at the same moment (objective completion).
    if (!gated && ledger.dials.length > 0) {
      await applyDialNudges(service, env, sessionId, ledger.dials)
    }

    if (ledger.digest) {
      // Per-PC credit has to survive into memory: coop affinity and spotlight balance read it,
      // and context compaction will discard the raw lines it came from.
      const credit = ledger.contributions.map((c) => `${c.name} ${c.did}`).join('; ')
      await writeMemoryFragment(
        service, env, 'scene_summary',
        `${label}: ${ledger.digest}${credit ? ` (${credit})` : ''}`,
      )
    }

    if (ledger.contradictions.length > 0) {
      // Drift audit (piggybacked on this call, no second agent). Never blocks - the text has
      // already shipped; the value is the DM seeing the drift accumulate.
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'ledger_contradiction', phase, label, contradictions: ledger.contradictions as unknown as Json,
      })
    }

    await logEvent(service, env.adventureId, sessionId, 'scene_ledger', {
      phase,
      label,
      digest: ledger.digest,
      proposed: ledger.milestones as unknown as Json,
      applied: milestonesApplied as unknown as Json,
      contributions: ledger.contributions as unknown as Json,
      gated,
    })

    if (gated && (ledger.milestones.length > 0 || ledger.npcStates.length > 0)) {
      await recordProposal(service, {
        adventureId: env.adventureId,
        sessionId,
        type: 'scene_ledger',
        payload: {
          phase, label, digest: ledger.digest,
          milestones: ledger.milestones as unknown as Json,
          npc_states: ledger.npcStates as unknown as Json,
        },
        mode: 'human',
        summary: `Record from "${label}": ${ledger.milestones.join(', ') || 'state changes'}`,
      })
    }

    return { milestonesApplied, digest: ledger.digest, contradictions: ledger.contradictions }
  } catch (err) {
    console.error('scene ledger failed', err)
    return EMPTY
  }
}
