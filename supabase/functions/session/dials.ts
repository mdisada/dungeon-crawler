// Story dials (F08 SS8.1): the summarizer pass that nudges per-adventure dial values.
// It used to run once, at session end, over the last 30 dialogue lines - a one-shot played in
// a single sitting therefore reached its endings' dial thresholds only by accident. The pass
// now also runs on objective completion, over everything recorded since the previous pass,
// and sees discoveries and story markers, not just talk.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import { applyDialNudge } from '../_shared/story/index.ts'
import type { AgentEnv } from './agents.ts'
import { runDialSummarizer } from './story-agents.ts'
import { assertOk, logEvent } from './util.ts'

/** Event types that carry evidence a dial should move. */
const EVIDENCE_TYPES = [
  'say', 'narration_published', 'ingredient_revealed', 'story_event', 'objective_completed',
  'encounter_resolved', 'npc_action',
]
const MAX_EVIDENCE = 60

interface EventRow {
  id: number
  type: string
  payload: Record<string, Json>
}

/** The id the previous pass consumed through, so each pass sees only new evidence. */
async function lastPassThrough(service: SupabaseClient, adventureId: string): Promise<number> {
  const { data } = await service
    .from('event_log')
    .select('payload')
    .eq('adventure_id', adventureId)
    .eq('type', 'dial_pass')
    .order('id', { ascending: false })
    .limit(1)
    .maybeSingle()
  const through = (data?.payload as Record<string, Json> | undefined)?.through_id
  return typeof through === 'number' ? through : 0
}

/**
 * Condenses everything since the last pass into summarizer input. Reveal ids are resolved to
 * their authored `reveals` text - "ingredient_revealed: <uuid>" tells the summarizer nothing.
 */
async function evidenceSince(
  service: SupabaseClient,
  adventureId: string,
  sinceId: number,
): Promise<{ lines: string[]; throughId: number }> {
  const { data, error } = await service
    .from('event_log')
    .select('id, type, payload')
    .eq('adventure_id', adventureId)
    .gt('id', sinceId)
    .in('type', EVIDENCE_TYPES)
    .order('id')
    .limit(MAX_EVIDENCE)
  assertOk(error, 'dial evidence load failed')
  const rows = (data ?? []) as EventRow[]
  if (rows.length === 0) return { lines: [], throughId: sinceId }

  const ingredientIds = rows
    .filter((r) => r.type === 'ingredient_revealed')
    .map((r) => String(r.payload.ingredient_id ?? ''))
    .filter(Boolean)
  const revealsById = new Map<string, string>()
  if (ingredientIds.length > 0) {
    const { data: ingredients } = await service
      .from('ingredients')
      .select('id, reveals')
      .in('id', ingredientIds)
    for (const row of (ingredients ?? []) as { id: string; reveals: string }[]) {
      revealsById.set(row.id, row.reveals ?? '')
    }
  }

  const lines = rows.map((row) => {
    if (row.type === 'ingredient_revealed') {
      const text = revealsById.get(String(row.payload.ingredient_id ?? '')) ?? ''
      return text ? `discovered: ${text}` : ''
    }
    const text = ['text', 'title', 'tag', 'name', 'label']
      .map((key) => row.payload[key])
      .filter((v): v is string => typeof v === 'string' && v.length > 0)
      .join(' - ')
    return text ? `${row.type}: ${text}` : ''
  }).filter(Boolean)

  return { lines, throughId: rows[rows.length - 1].id }
}

interface DialSet {
  dials: { key: string; name: string; description: string }[]
  values: Record<string, number>
}

/** The adventure's declared dials + live values. Empty `dials` means there is nothing to move. */
async function loadDials(service: SupabaseClient, adventureId: string): Promise<DialSet> {
  const { data } = await service
    .from('adventures')
    .select('story_dials, dial_values')
    .eq('id', adventureId)
    .single()
  return {
    dials: (data?.story_dials ?? []) as DialSet['dials'],
    values: (data?.dial_values ?? {}) as Record<string, number>,
  }
}

/**
 * Runs the summarizer over `transcript` and applies the clamped nudges. Returns the number of
 * dials moved. Best-effort by contract - dial movement must never break the caller's flow.
 */
export async function applyDialMoves(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string | null,
  transcript: string[],
  preloaded?: DialSet,
): Promise<number> {
  if (transcript.length === 0) return 0
  const { dials, values: current } = preloaded ?? (await loadDials(service, env.adventureId))
  if (dials.length === 0) return 0

  const moves = await runDialSummarizer(env, dials, transcript)
  if (moves.length === 0) return 0

  const values = { ...current }
  for (const move of moves) {
    const next = applyDialNudge(values[move.dial] ?? 0, move.delta)
    await logEvent(service, env.adventureId, sessionId, 'dial_nudged', {
      dial: move.dial, from: values[move.dial] ?? 0, to: next, why: move.why,
    })
    values[move.dial] = next
  }
  await service.from('adventures').update({ dial_values: values as unknown as Json }).eq('id', env.adventureId)
  return moves.length
}

/**
 * The incremental pass: new evidence since the last one, then mark how far it consumed.
 *
 * Dials are checked FIRST and on their own. This runs inside the story-progress pass, which
 * already carries the app's longest agent chain - an adventure with no declared dials must not
 * pay for an evidence sweep it can do nothing with (a WORKER_RESOURCE_LIMIT on that chain is
 * how the cost showed up, live 2026-07-20).
 */
export async function runDialPass(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string | null,
  trigger: string,
): Promise<void> {
  const dialSet = await loadDials(service, env.adventureId)
  if (dialSet.dials.length === 0) return
  const sinceId = await lastPassThrough(service, env.adventureId)
  const { lines, throughId } = await evidenceSince(service, env.adventureId, sinceId)
  if (lines.length === 0) return
  const moved = await applyDialMoves(service, env, sessionId, lines, dialSet)
  await logEvent(service, env.adventureId, sessionId, 'dial_pass', {
    trigger, through_id: throughId, evidence: lines.length, moved,
  })
}
