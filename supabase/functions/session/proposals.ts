// Proposal pipeline (F07 SS4). One code path, one flag: full-AI records every consequential
// step as an auto_applied proposal; assist mode inserts pending rows + notifies the dm channel.
// The human accept/edit/reject *console* is Phase 10 - the server side of deciding lives here
// so the lifecycle is complete and testable now.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json, ProposalEntry } from '../_shared/state/index.ts'
import { assertOk, broadcast, commitDiffs, loadContext } from './util.ts'

export const PROPOSAL_EXPIRY_MS = 5 * 60 * 1000

const DM_TRAY_LIMIT = 20

export interface ProposalInput {
  adventureId: string
  sessionId: string | null
  type: string
  payload: Json
  options?: Json
  mode: 'human' | 'auto'
  blocking?: boolean
  summary: string
  contextRefs?: Json
}

/**
 * Records a proposal and mirrors it into the dm.proposals tray (bounded, newest first).
 * Returns the row id. Auto mode = applied by the caller right after; status reflects that.
 */
export async function recordProposal(service: SupabaseClient, input: ProposalInput): Promise<string> {
  const auto = input.mode === 'auto'
  const { data, error } = await service
    .from('proposals')
    .insert({
      adventure_id: input.adventureId,
      session_id: input.sessionId,
      type: input.type,
      payload: input.payload,
      options: input.options ?? null,
      approval_mode: input.mode,
      status: auto ? 'auto_applied' : 'pending',
      decision: auto ? { decided_by: 'auto', decided_at: new Date().toISOString() } : null,
      context_refs: input.contextRefs ?? null,
      blocking: input.blocking ?? false,
      decided_at: auto ? new Date().toISOString() : null,
    })
    .select('id, created_at')
    .single()
  assertOk(error, 'proposal insert failed')

  const entry: ProposalEntry = {
    id: data.id as string,
    type: input.type,
    status: auto ? 'auto_applied' : 'pending',
    summary: input.summary,
    createdAt: data.created_at as string,
  }
  await commitDiffs(service, input.adventureId, (state) => {
    const current = (state.dm?.proposals ?? []) as ProposalEntry[]
    return [{ domain: 'dm', patch: { proposals: [entry, ...current].slice(0, DM_TRAY_LIMIT) as unknown as Json } }]
  })
  if (!auto) {
    await broadcast(`dm:${input.adventureId}`, 'proposal', { id: entry.id, type: entry.type, summary: entry.summary })
  }
  return entry.id
}

/**
 * Assist-mode decision endpoint (server side complete now, console UI in Phase 10).
 * Expired proposals can never be applied (F07 acceptance criterion).
 */
export async function decideProposal(
  service: SupabaseClient,
  adventureId: string,
  userId: string,
  proposalId: string,
  verdict: 'accepted' | 'rejected' | 'edited',
  editDiff: Json | null,
) {
  const ctx = await loadContext(service, adventureId, userId)
  if (!ctx?.isDm) return { status: 403, body: { error: 'Only the DM can decide proposals' } }

  const { data: proposal, error } = await service
    .from('proposals')
    .select('id, status, created_at, approval_mode')
    .eq('id', proposalId)
    .eq('adventure_id', adventureId)
    .maybeSingle()
  assertOk(error, 'proposal load failed')
  if (!proposal) return { status: 404, body: { error: 'Proposal not found' } }
  if (proposal.status !== 'pending') return { status: 409, body: { error: `Proposal is ${proposal.status}` } }

  if (Date.now() - Date.parse(proposal.created_at as string) > PROPOSAL_EXPIRY_MS) {
    await setProposalStatus(service, adventureId, proposalId, 'expired', null)
    return { status: 409, body: { error: 'Proposal expired' } }
  }

  const decision: Json = {
    decided_by: userId,
    decided_at: new Date().toISOString(),
    ...(verdict === 'edited' && editDiff !== null ? { edit_diff: editDiff } : {}),
  }
  await setProposalStatus(service, adventureId, proposalId, verdict, decision)
  return { status: 200, body: { ok: true, status: verdict } }
}

async function setProposalStatus(
  service: SupabaseClient,
  adventureId: string,
  proposalId: string,
  status: string,
  decision: Json | null,
): Promise<void> {
  const { error } = await service
    .from('proposals')
    .update({ status, decision, decided_at: new Date().toISOString() })
    .eq('id', proposalId)
  assertOk(error, 'proposal update failed')
  await commitDiffs(service, adventureId, (state) => {
    const tray = ((state.dm?.proposals ?? []) as ProposalEntry[]).map((p) =>
      p.id === proposalId ? { ...p, status } : p,
    )
    return [{ domain: 'dm', patch: { proposals: tray as unknown as Json } }]
  })
}

/** Marks stale pending proposals expired (superseded-by-events rule, run before new proposals). */
export async function expireStaleProposals(service: SupabaseClient, adventureId: string): Promise<void> {
  const cutoff = new Date(Date.now() - PROPOSAL_EXPIRY_MS).toISOString()
  const { data: stale } = await service
    .from('proposals')
    .select('id')
    .eq('adventure_id', adventureId)
    .eq('status', 'pending')
    .lt('created_at', cutoff)
  for (const row of stale ?? []) {
    await setProposalStatus(service, adventureId, row.id as string, 'expired', null)
  }
}
