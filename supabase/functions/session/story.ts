// F08 SS2.1 quest offers: staging (entry + re-weave), free-text accept/decline/negotiate
// resolution, the party ledger payout, and the core-loop stack glue. The story is offered,
// not imposed - nothing quest-shaped activates until a player says yes. All reaction beats go
// through the Narrator (narration.ts) so this module never imports the NPC pipeline (no cycle).

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { clampDisposition, promptDeadline, socialDc, SOLO_PROMPT_WINDOW_S } from '../_shared/play/index.ts'
import type { CheckResult } from '../_shared/play/index.ts'
import type { Json, OfferBannerView, QuestJournalView, StateDiff } from '../_shared/state/index.ts'
import {
  canReweave, canStageOffer, completeLoop, negotiatedGold, offerBanner, openingTerms,
  parseDeadlineRecords, parseRewardBounds, pushLoop, scheduleDeadline,
} from '../_shared/story/index.ts'
import type { OfferTerms, RewardBounds } from '../_shared/story/index.ts'
import { runOfferClassifier } from './agents.ts'
import type { AgentEnv } from './agents.ts'
import { loadLoops, persistLoops, planAndOpenBeat } from './beats.ts'
import { narrationBeat } from './narration.ts'
import { appendLinesDiff, loadPartyCharacters, newLine, pendingDiffs, typingDiff } from './orchestrate.ts'
import type { CharacterRow } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import type { NegotiateStash } from './stashes.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

export interface ContractRow {
  id: string
  label: string
  giver_npc_id: string
  is_entry: boolean
  reward: Json
  stakes: string
  deadline: Json | null
  objective_ids: string[]
}

interface OfferRow {
  id: string
  contract_id: string | null
  quest_label: string
  giver_npc_id: string | null
  terms: Json
  status: string
  core_loop_id: string | null
  reweave_count: number
  paid_at: string | null
}

/** Negotiation check context parked in dm.conversation.pendingContext while the die is out. */
const CONTRACT_COLUMNS = 'id, label, giver_npc_id, is_entry, reward, stakes, deadline, objective_ids'

function termsOf(offer: OfferRow): OfferTerms {
  const obj = (typeof offer.terms === 'object' && offer.terms !== null ? offer.terms : {}) as Record<string, Json>
  return {
    gold: Number(obj.gold) || 0,
    extras: Array.isArray(obj.extras) ? obj.extras.filter((x): x is string => typeof x === 'string') : [],
    stakes: typeof obj.stakes === 'string' ? obj.stakes : '',
    deadlineDays: typeof obj.deadlineDays === 'number' ? obj.deadlineDays : null,
  }
}

export async function entryContract(service: SupabaseClient, adventureId: string): Promise<ContractRow | null> {
  const { data, error } = await service
    .from('quest_contracts')
    .select(CONTRACT_COLUMNS)
    .eq('adventure_id', adventureId)
    .eq('is_entry', true)
    .maybeSingle()
  assertOk(error, 'entry contract load failed')
  return data as ContractRow | null
}

async function loadContract(service: SupabaseClient, adventureId: string, contractId: string): Promise<ContractRow | null> {
  const { data, error } = await service
    .from('quest_contracts')
    .select(CONTRACT_COLUMNS)
    .eq('adventure_id', adventureId)
    .eq('id', contractId)
    .maybeSingle()
  assertOk(error, 'contract load failed')
  return data as ContractRow | null
}

async function offersByStatus(service: SupabaseClient, adventureId: string, statuses: string[]): Promise<OfferRow[]> {
  const { data, error } = await service
    .from('quest_offers')
    .select('id, contract_id, quest_label, giver_npc_id, terms, status, core_loop_id, reweave_count, paid_at')
    .eq('adventure_id', adventureId)
    .in('status', statuses)
    .order('offered_at', { ascending: true })
  assertOk(error, 'offers load failed')
  return (data ?? []) as OfferRow[]
}

async function npcNames(service: SupabaseClient, ids: string[]): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))]
  if (unique.length === 0) return new Map()
  const { data, error } = await service.from('npcs').select('id, name').in('id', unique)
  assertOk(error, 'npc names load failed')
  return new Map((data ?? []).map((n) => [n.id as string, n.name as string]))
}

/** Rebuilds the player-visible journal (offers banner + quests) from the tables. */
export async function journalViews(
  service: SupabaseClient,
  adventureId: string,
): Promise<{ offers: OfferBannerView[]; quests: QuestJournalView[] }> {
  const rows = await offersByStatus(service, adventureId, ['offered', 'accepted'])
  const names = await npcNames(service, rows.map((r) => r.giver_npc_id ?? ''))
  const loops = await loadLoops(service, adventureId)
  const loopStatus = new Map(loops.map((l) => [l.id, l.status]))

  const offers: OfferBannerView[] = rows
    .filter((r) => r.status === 'offered')
    .map((r) => {
      const terms = termsOf(r)
      return {
        id: r.id,
        label: r.quest_label,
        giverName: names.get(r.giver_npc_id ?? '') ?? 'someone',
        gold: terms.gold,
        stakes: terms.stakes,
      }
    })
  const quests: QuestJournalView[] = rows
    .filter((r) => r.status === 'accepted')
    .map((r) => {
      const terms = termsOf(r)
      const status = r.paid_at
        ? 'completed'
        : r.core_loop_id && loopStatus.get(r.core_loop_id) === 'completed'
          ? 'completed'
          : r.core_loop_id && loopStatus.get(r.core_loop_id) === 'suspended'
            ? 'suspended'
            : 'active'
      return {
        id: r.id,
        label: r.quest_label,
        giverName: names.get(r.giver_npc_id ?? '') ?? 'someone',
        gold: terms.gold,
        stakes: terms.stakes,
        status,
      }
    })
  return { offers, quests }
}

export async function journalPatch(service: SupabaseClient, adventureId: string): Promise<StateDiff> {
  const views = await journalViews(service, adventureId)
  return { domain: 'objectives', patch: views as unknown as Json }
}

/** Small local disposition shift (accept/decline goodwill); the F10 pipeline owns the big moves. */
async function shiftDisposition(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  npcId: string | null,
  characterId: string,
  delta: number,
  reason: string,
): Promise<void> {
  if (!npcId || delta === 0) return
  const { data, error } = await service
    .from('npc_dispositions')
    .select('value')
    .eq('npc_id', npcId)
    .eq('character_id', characterId)
    .maybeSingle()
  assertOk(error, 'disposition load failed')
  const current = Number(data?.value ?? 0)
  const next = clampDisposition(current + delta)
  const { error: writeError } = await service.from('npc_dispositions').upsert(
    { npc_id: npcId, character_id: characterId, adventure_id: env.adventureId, value: next, updated_at: new Date().toISOString() },
    { onConflict: 'npc_id,character_id' },
  )
  assertOk(writeError, 'disposition write failed')
  await logEvent(service, env.adventureId, sessionId, 'disposition_changed', {
    npc_id: npcId, character_id: characterId, from: current, to: next, reason,
  })
}

/**
 * Stage an offer from a contract (F08 SS2.1): row + banner + system line + the in-fiction ask
 * (a narration beat ending on the giver awaiting an answer). Re-weaves must come from a
 * different angle with escalated terms; the budget is enforced here.
 */
export async function stageOffer(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  contract: ContractRow,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const open = await offersByStatus(service, env.adventureId, ['offered'])
  if (!canStageOffer(open.length)) {
    return { status: 409, body: { error: 'Too many open offers - resolve one first' } }
  }
  if (open.some((o) => o.contract_id === contract.id)) {
    return { status: 409, body: { error: 'This contract already has an open offer' } }
  }
  const { data: priorRows, error: priorError } = await service
    .from('quest_offers')
    .select('id, status, terms')
    .eq('adventure_id', env.adventureId)
    .eq('contract_id', contract.id)
  assertOk(priorError, 'prior offers load failed')
  const prior = priorRows ?? []
  if (prior.some((p) => p.status === 'accepted')) {
    return { status: 409, body: { error: 'This contract was already accepted' } }
  }
  const declined = prior.filter((p) => p.status === 'declined')
  if (declined.length > 0 && !canReweave(declined.length)) {
    await logEvent(service, env.adventureId, sessionId, 'consequence_due', {
      contract_id: contract.id, declined: declined.length,
    })
    return { status: 409, body: { error: 'Re-weave budget exhausted - consequences, not offers, come next' } }
  }

  const bounds = parseRewardBounds(contract.reward)
  const deadlineDays = typeof contract.deadline === 'object' && contract.deadline !== null
    ? Number((contract.deadline as Record<string, Json>).days) || null
    : null
  let terms = openingTerms(bounds, contract.stakes, deadlineDays)
  // Escalating re-weave: each declined round raises the opening bid halfway to the ceiling.
  for (let i = 0; i < declined.length; i++) terms = { ...terms, gold: negotiatedGold(terms.gold, bounds, 0) }

  const { data: offer, error } = await service
    .from('quest_offers')
    .insert({
      adventure_id: env.adventureId,
      contract_id: contract.id,
      quest_label: contract.label,
      giver_npc_id: contract.giver_npc_id,
      terms: terms as unknown as Json,
      reweave_count: declined.length,
    })
    .select('id')
    .single()
  assertOk(error, 'offer insert failed')

  const names = await npcNames(service, [contract.giver_npc_id])
  const giver = names.get(contract.giver_npc_id) ?? 'someone'
  const banner = offerBanner(contract.label, giver, terms.gold)
  await logEvent(service, env.adventureId, sessionId, 'offer_staged', {
    offer_id: offer.id, contract_id: contract.id, gold: terms.gold, reweave: declined.length,
  })

  const patch = await journalPatch(service, env.adventureId)
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(null, null, `Offer: ${banner}`)]),
    patch,
  ])
  const angle = declined.length > 0
    ? `This is attempt ${declined.length + 1} - come from a genuinely different angle than before (new urgency, personal stakes, or visible consequences), and mention the improved pay.`
    : 'This is the first ask.'
  await narrationBeat(
    service, env, sessionId,
    `${giver} offers the party a job in-fiction: "${contract.label}". Stated reward: ${terms.gold} gp. ` +
      `Why it matters to ${giver}: ${contract.stakes || 'unstated'}. ${angle} ` +
      'End with the giver awaiting the party\'s answer - do not answer for them.',
    'Quest offer',
  )
  return { status: 200, body: { ok: true, offer_id: offer.id, banner } }
}

/** dm_command surface: stage (or re-weave) an offer from a contract by id. */
export async function stageOfferByContractId(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  contractId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const contract = await loadContract(service, env.adventureId, contractId)
  if (!contract) return { status: 404, body: { error: 'Contract not found' } }
  return stageOffer(service, env, sessionId, contract)
}

/** Session-start hook: the entry contract becomes the first offer, once. */
export async function stageEntryOfferIfNeeded(service: SupabaseClient, env: AgentEnv, sessionId: string): Promise<void> {
  const contract = await entryContract(service, env.adventureId)
  if (!contract) return
  const { data, error } = await service
    .from('quest_offers')
    .select('id')
    .eq('adventure_id', env.adventureId)
    .eq('contract_id', contract.id)
    .in('status', ['offered', 'accepted'])
    .limit(1)
  assertOk(error, 'entry offer lookup failed')
  if ((data ?? []).length > 0) return
  await stageOffer(service, env, sessionId, contract)
}

/** Enough table activity since the decline that a re-approach reads as "later", not a nag. */
export const REWEAVE_MIN_EVENTS = 8

/**
 * Automated re-weave (F08 SS6): once enough play has passed since a decline, the Hook Weaver
 * re-offers from a different angle - budget-capped; after that, consequences, not offers.
 * Called opportunistically on story-progress passes (edge functions have no timers).
 */
export async function maybeReweaveDeclined(service: SupabaseClient, env: AgentEnv, sessionId: string): Promise<void> {
  const { data, error } = await service
    .from('quest_offers')
    .select('contract_id, status, resolved_at')
    .eq('adventure_id', env.adventureId)
    .not('contract_id', 'is', null)
  assertOk(error, 'offers load failed')
  const byContract = new Map<string, { statuses: string[]; lastDeclinedAt: string | null }>()
  for (const row of (data ?? []) as { contract_id: string; status: string; resolved_at: string | null }[]) {
    const entry = byContract.get(row.contract_id) ?? { statuses: [], lastDeclinedAt: null }
    entry.statuses.push(row.status)
    if (row.status === 'declined' && row.resolved_at && (!entry.lastDeclinedAt || row.resolved_at > entry.lastDeclinedAt)) {
      entry.lastDeclinedAt = row.resolved_at
    }
    byContract.set(row.contract_id, entry)
  }
  for (const [contractId, entry] of byContract) {
    if (entry.statuses.some((s) => s === 'offered' || s === 'accepted')) continue
    const declined = entry.statuses.filter((s) => s === 'declined').length
    if (declined === 0 || !canReweave(declined) || !entry.lastDeclinedAt) continue
    const { count } = await service
      .from('event_log')
      .select('id', { count: 'exact', head: true })
      .eq('adventure_id', env.adventureId)
      .gt('created_at', entry.lastDeclinedAt)
    if ((count ?? 0) < REWEAVE_MIN_EVENTS) continue
    const contract = await loadContract(service, env.adventureId, contractId)
    if (contract) await stageOffer(service, env, sessionId, contract)
  }
}

/**
 * Pre-routing hook (F08 SS2.1): with an open offer on the table, a say/do utterance runs the
 * offer classifier first. Any PC's clear accept binds the party; unrelated falls through to
 * the normal pipeline (returns null).
 */
export async function maybeHandleOfferResponse(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
): Promise<{ status: number; body: Record<string, unknown> } | null> {
  const open = await offersByStatus(service, env.adventureId, ['offered'])
  if (open.length === 0) return null
  const offer = open[open.length - 1]
  const terms = termsOf(offer)
  const names = await npcNames(service, [offer.giver_npc_id ?? ''])
  const giver = names.get(offer.giver_npc_id ?? '') ?? 'someone'
  const summary = `${offerBanner(offer.quest_label, giver, terms.gold)}; stakes: ${terms.stakes || 'unstated'}`

  const response = await runOfferClassifier(env, summary, text)
  if (response === 'unrelated') return null
  await logEvent(service, env.adventureId, sessionId, 'offer_response', {
    offer_id: offer.id, response, character_id: character.id, text: text.slice(0, 200),
  })

  if (response === 'accept') return acceptOffer(service, env, sessionId, offer, character, text, giver)
  if (response === 'decline') return declineOffer(service, env, sessionId, offer, character, text, giver)
  return stageNegotiation(service, env, sessionId, offer, character, text, giver)
}

/**
 * The world makes the choice (overhaul Phase 4). A party that never answers the entry offer
 * has no active objective, so the whole objective ladder - guaranteed routes and fail-forward
 * included - is unreachable, and the director can only press the offer forever. Live
 * 2026-07-23, a 30-turn passive run: 6 presses, 0 objectives, story never began.
 *
 * The tabletop answer is the hard move: stop asking and let events overtake them. Mechanically
 * this is a normal acceptance (loop pushed, first objective active, first beat opened) - the
 * narration just frames it as the situation closing around the party rather than a handshake.
 */
export async function forceAcceptOffer(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
): Promise<boolean> {
  if (env.mode !== 'full_ai') return false
  const [offer] = await offersByStatus(service, env.adventureId, ['offered'])
  if (!offer) return false
  const party = await loadPartyCharacters(service, env.adventureId)
  const actor = party[0]
  if (!actor) return false
  const giver = (await npcNames(service, [offer.giver_npc_id ?? ''])).get(offer.giver_npc_id ?? '') ?? 'someone'
  await logEvent(service, env.adventureId, sessionId, 'offer_forced', {
    offer_id: offer.id, label: offer.quest_label, reason: 'unanswered - events overtook the party',
  })
  const result = await acceptOffer(service, env, sessionId, offer, actor, '', giver, { forced: true })
  return result.status === 200
}

async function acceptOffer(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  offer: OfferRow,
  character: CharacterRow,
  text: string,
  giver: string,
  opts?: { forced?: boolean },
) {
  const loops = await loadLoops(service, env.adventureId)
  const push = pushLoop(loops, { id: crypto.randomUUID(), type: 'custom', customLabel: offer.quest_label })
  if (!push.ok) return { status: 500, body: { error: push.error } }
  await persistLoops(service, env.adventureId, loops, push.loops)
  const newLoopId = push.loops[push.loops.length - 1].id

  const { error } = await service
    .from('quest_offers')
    .update({ status: 'accepted', core_loop_id: newLoopId, resolved_at: new Date().toISOString() })
    .eq('id', offer.id)
    .eq('status', 'offered')
  assertOk(error, 'offer accept failed')

  // Acceptance gates activation (F08 SS9): the quest's first authored objective goes active.
  let activatedObjective: { id: string; title: string } | null = null
  if (offer.contract_id) {
    const contract = await loadContract(service, env.adventureId, offer.contract_id)
    const firstObjectiveId = contract?.objective_ids?.[0]
    if (firstObjectiveId) {
      const { data: objective } = await service
        .from('objectives')
        .select('id, title, reveal_state')
        .eq('id', firstObjectiveId)
        .maybeSingle()
      if (objective && objective.reveal_state === 'hidden') {
        await service.from('objectives').update({ reveal_state: 'active' }).eq('id', objective.id)
        activatedObjective = { id: objective.id as string, title: objective.title as string }
      }
    }
  }

  const terms = termsOf(offer)
  await shiftDisposition(service, env, sessionId, offer.giver_npc_id, character.id, 1, 'accepted the offer')
  await logEvent(service, env.adventureId, sessionId, 'offer_accepted', {
    offer_id: offer.id, core_loop_id: newLoopId, by: character.id, gold: terms.gold,
  })

  // Start the clock the party just agreed to. `deadline.days` has been authored by stage 6,
  // parsed here, and printed in the banner as a term since the beginning - with nothing
  // anywhere consuming it. A deadline nobody enforces advertises stakes the engine cannot
  // deliver, which is worse than having none.
  if (offer.contract_id && terms.deadlineDays && terms.deadlineDays > 0) {
    const current = (await loadState(service, env.adventureId)).state
    const records = scheduleDeadline(
      parseDeadlineRecords(current.dm?.story?.deadlines as Json),
      {
        contractId: offer.contract_id,
        label: offer.quest_label,
        dueDay: current.scene.day + terms.deadlineDays,
        giverNpcId: offer.giver_npc_id ?? null,
      },
    )
    await commitDiffs(service, env.adventureId, () => [
      { domain: 'dm', patch: { story: { deadlines: records as unknown as Json } } },
    ])
    await logEvent(service, env.adventureId, sessionId, 'deadline_started', {
      contract_id: offer.contract_id, label: offer.quest_label,
      due_day: current.scene.day + terms.deadlineDays, days: terms.deadlineDays,
    })
  }

  const patch = await journalPatch(service, env.adventureId)
  const accepted = opts?.forced
    ? `The matter is no longer optional: ${offerBanner(offer.quest_label, giver, terms.gold)}`
    : `Contract accepted: ${offerBanner(offer.quest_label, giver, terms.gold)}`
  await commitDiffs(service, env.adventureId, (s) => {
    const activated = activatedObjective
    const diffs: StateDiff[] = [
      appendLinesDiff(
        s,
        // A forced start has no player utterance to echo - only the world's line.
        opts?.forced
          ? [newLine(null, null, accepted)]
          : [newLine(character.name, null, text), newLine(null, null, accepted)],
        { typing: true },
      ),
      patch,
    ]
    if (activated) {
      diffs.push({
        domain: 'objectives',
        patch: {
          currentId: s.objectives.currentId ?? activated.id,
          list: [
            ...s.objectives.list.filter((o) => o.id !== activated.id),
            { id: activated.id, title: activated.title, state: 'active' },
          ] as unknown as Json,
        },
      })
    }
    return diffs
  })
  // The quest's first beat opens immediately (F08 SS9.1 event-driven pacing); the acceptance
  // reaction folds into its opening narration so the table gets one beat, not two. This is
  // the longest agent chain in the app - a failure must never wedge the table on typing:true
  // (the acceptance itself is already durable; the beat can open later via plan_beat/nudge).
  try {
    await planAndOpenBeat(
      service, env, sessionId, newLoopId, opts?.forced ? 'quest_forced' : 'quest_accepted',
      opts?.forced
        ? `The party never answered ${giver} about "${offer.quest_label}", so events have overtaken them - ` +
          'narrate the situation closing around the party so they are IN it now whether they agreed or not ' +
          '(something arrives, gives way, or is discovered). Never scold them for hesitating.'
        : `${character.name} just accepted ${giver}'s offer ("${offer.quest_label}", ${terms.gold} gp promised) - ` +
          `narrate ${giver}'s reaction first.`,
    )
  } catch (err) {
    console.error('beat open after acceptance failed', err)
    await logEvent(service, env.adventureId, sessionId, 'incident', {
      kind: 'beat_open_failed', trigger: 'quest_accepted', core_loop_id: newLoopId,
    })
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
  }
  return { status: 200, body: { ok: true, resolved: 'offer_accepted', core_loop_id: newLoopId } }
}

async function declineOffer(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  offer: OfferRow,
  character: CharacterRow,
  text: string,
  giver: string,
) {
  const { error } = await service
    .from('quest_offers')
    .update({ status: 'declined', resolved_at: new Date().toISOString() })
    .eq('id', offer.id)
    .eq('status', 'offered')
  assertOk(error, 'offer decline failed')

  await shiftDisposition(service, env, sessionId, offer.giver_npc_id, character.id, -1, 'declined the offer')
  const reweavesLeft = canReweave(offer.reweave_count + 1)
  await logEvent(service, env.adventureId, sessionId, 'offer_declined', {
    offer_id: offer.id, by: character.id, reweave_count: offer.reweave_count, reweaves_left: reweavesLeft,
  })
  if (!reweavesLeft) {
    // Budget spent: the Steward escalates consequences instead of another ask (slice 4 consumes this).
    await logEvent(service, env.adventureId, sessionId, 'consequence_due', {
      contract_id: offer.contract_id, offer_id: offer.id,
    })
  }

  const patch = await journalPatch(service, env.adventureId)
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(character.name, null, text), newLine(null, null, `Offer declined: ${offer.quest_label}`)], { typing: true }),
    patch,
  ])
  await narrationBeat(
    service, env, sessionId,
    `The party declines ${giver}'s offer ("${offer.quest_label}"). Narrate ${giver}'s reaction - ` +
      'disappointed but human, no guilt-tripping, the refusal stands. End at a concrete decision ' +
      'point about what the party does instead.',
    'Offer declined',
  )
  return { status: 200, body: { ok: true, resolved: 'offer_declined' } }
}

/** Haggling (F08 SS2.1): an influence check against the giver, bounded by the contract. */
async function stageNegotiation(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  offer: OfferRow,
  character: CharacterRow,
  text: string,
  giver: string,
) {
  const { data: dispositionRow } = offer.giver_npc_id
    ? await service
        .from('npc_dispositions')
        .select('value')
        .eq('npc_id', offer.giver_npc_id)
        .eq('character_id', character.id)
        .maybeSingle()
    : { data: null }
  const dc = socialDc('reasonable', Number(dispositionRow?.value ?? 0))
  const stash: NegotiateStash = {
    flow: 'negotiate',
    offerId: offer.id,
    npcId: offer.giver_npc_id,
    utterance: { actorCharacterId: character.id, actorName: character.name, text },
    skill: 'persuasion',
    dc,
  }
  await commitDiffs(service, env.adventureId, (s) => [
    appendLinesDiff(s, [newLine(character.name, null, text)]),
    ...pendingDiffs(
      {
        kind: 'check',
        id: crypto.randomUUID(),
        actorCharacterId: character.id,
        skill: 'persuasion',
        advDis: 'none',
        reason: `Haggle with ${giver}`,
        deadline: promptDeadline(new Date(), SOLO_PROMPT_WINDOW_S),
      },
      stash as unknown as Json,
    ),
  ])
  await logEvent(service, env.adventureId, sessionId, 'negotiation_prompted', {
    offer_id: offer.id, character_id: character.id, dc,
  })
  return { status: 200, body: { ok: true, resolved: 'check_prompted', skill: 'persuasion' } }
}

/** Resumes a rolled negotiation check: success improves terms within the authored bounds. */
export async function finishNegotiation(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  stash: NegotiateStash,
  result: CheckResult & { skill: string },
): Promise<void> {
  const { data, error } = await service
    .from('quest_offers')
    .select('id, contract_id, quest_label, giver_npc_id, terms, status, core_loop_id, reweave_count, paid_at')
    .eq('id', stash.offerId)
    .maybeSingle()
  assertOk(error, 'offer load failed')
  const offer = data as OfferRow | null
  if (!offer || offer.status !== 'offered') {
    await commitDiffs(service, env.adventureId, () => [...pendingDiffs(null, null), typingDiff(false)])
    return
  }

  const terms = termsOf(offer)
  const contract = offer.contract_id ? await loadContract(service, env.adventureId, offer.contract_id) : null
  const bounds: RewardBounds = contract
    ? parseRewardBounds(contract.reward)
    : { goldFloor: terms.gold, goldCeiling: terms.gold, extras: terms.extras }
  const nextGold = result.success ? negotiatedGold(terms.gold, bounds, result.margin) : terms.gold
  const improved = nextGold > terms.gold

  if (improved) {
    const { error: updateError } = await service
      .from('quest_offers')
      .update({ terms: { ...terms, gold: nextGold } as unknown as Json })
      .eq('id', offer.id)
      .eq('status', 'offered')
    assertOk(updateError, 'terms update failed')
  }
  await logEvent(service, env.adventureId, sessionId, 'offer_negotiated', {
    offer_id: offer.id, success: result.success, from: terms.gold, to: nextGold,
  })
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'offer_negotiation',
    payload: { offer_id: offer.id, from: terms.gold, to: nextGold, success: result.success },
    mode: 'auto',
    summary: `Haggling ${result.success ? 'succeeded' : 'failed'}: ${terms.gold} -> ${nextGold} gp`,
  })

  const names = await npcNames(service, [offer.giver_npc_id ?? ''])
  const giver = names.get(offer.giver_npc_id ?? '') ?? 'someone'
  const patch = await journalPatch(service, env.adventureId)
  await commitDiffs(service, env.adventureId, (s) => [
    ...(improved
      ? [appendLinesDiff(s, [newLine(null, null, `Terms improved: ${offer.quest_label} - now ${nextGold} gp`)])]
      : []),
    patch,
    ...pendingDiffs(null, null),
    typingDiff(true),
  ])
  await narrationBeat(
    service, env, sessionId,
    `${stash.utterance.actorName} haggles with ${giver} over the "${offer.quest_label}" job. ` +
      `The persuasion check ${result.success ? 'SUCCEEDS' : 'FAILS'}. ` +
      (improved
        ? `${giver} concedes: the pay rises to ${nextGold} gp.`
        : result.success
          ? `${giver} holds firm at ${terms.gold} gp - the terms were already at their limit.`
          : `${giver} holds firm at ${terms.gold} gp.`) +
      ' End with the offer still on the table, awaiting the party\'s answer.',
    'Negotiation outcome',
  )
}

/**
 * Completes the quest's loop and pays the ledger exactly once (idempotency via paid_at). Reached
 * two ways: the DM/creator `complete_quest` override (F07 SS5.2), and automatically when a quest's
 * final objective completes (see maybeCompleteQuestForObjective, F08 SS9).
 */
export async function completeQuest(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  offerId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const { data, error } = await service
    .from('quest_offers')
    .select('id, contract_id, quest_label, giver_npc_id, terms, status, core_loop_id, reweave_count, paid_at')
    .eq('adventure_id', env.adventureId)
    .eq('id', offerId)
    .maybeSingle()
  assertOk(error, 'offer load failed')
  const offer = data as OfferRow | null
  if (!offer || offer.status !== 'accepted') {
    return { status: 409, body: { error: 'No accepted quest with that id' } }
  }

  const loops = await loadLoops(service, env.adventureId)
  const questLoop = offer.core_loop_id ? loops.find((l) => l.id === offer.core_loop_id) ?? null : null
  if (offer.paid_at || questLoop?.status === 'completed') {
    return { status: 409, body: { error: 'Quest already completed' } }
  }

  if (questLoop) {
    const done = completeLoop(loops, questLoop.id)
    if (done.ok) {
      await persistLoops(service, env.adventureId, loops, done.loops)
      if (done.resumedId) {
        await logEvent(service, env.adventureId, sessionId, 'loop_resumed', { core_loop_id: done.resumedId })
      }
    }
  }

  const terms = termsOf(offer)
  let paid = false
  if (!offer.paid_at && terms.gold > 0) {
    // Claim the payout row first - the paid_at guard makes double completion a no-op.
    const { data: claimed, error: claimError } = await service
      .from('quest_offers')
      .update({ paid_at: new Date().toISOString() })
      .eq('id', offer.id)
      .is('paid_at', null)
      .select('id')
    assertOk(claimError, 'payout claim failed')
    paid = (claimed ?? []).length > 0
  }

  const names = await npcNames(service, [offer.giver_npc_id ?? ''])
  const giver = names.get(offer.giver_npc_id ?? '') ?? 'someone'
  const patch = await journalPatch(service, env.adventureId)
  let goldAfter = 0
  await commitDiffs(service, env.adventureId, (s) => {
    goldAfter = s.players.gold + (paid ? terms.gold : 0)
    const line = paid
      ? `Quest complete: ${offer.quest_label} - the party receives ${terms.gold} gp (party gold: ${goldAfter})`
      : `Quest complete: ${offer.quest_label}`
    return [
      appendLinesDiff(s, [newLine(null, null, line)]),
      { domain: 'players', patch: { gold: goldAfter } },
      patch,
    ]
  })
  if (paid) {
    await logEvent(service, env.adventureId, sessionId, 'ledger_credited', {
      offer_id: offer.id, gold: terms.gold, balance: goldAfter,
    })
  }
  await logEvent(service, env.adventureId, sessionId, 'quest_completed', {
    offer_id: offer.id, core_loop_id: offer.core_loop_id, paid,
  })
  await narrationBeat(
    service, env, sessionId,
    `The party completes the job "${offer.quest_label}" for ${giver}. ` +
      (paid ? `${giver} pays the promised ${terms.gold} gp. ` : '') +
      'Narrate the resolution and end at a concrete decision point about what comes next.',
    'Quest complete',
  )
  return { status: 200, body: { ok: true, paid, gold: paid ? terms.gold : 0 } }
}

/**
 * F08 SS9 deterministic quest completion: when a completed objective was the last open objective
 * of an accepted quest's contract, close the quest (loop + one-time ledger payout) the same way
 * the DM `complete_quest` override does. No-op for objectives with no contract or whose contract
 * still has open objectives. Returns true when a quest was completed.
 */
export async function maybeCompleteQuestForObjective(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  completedObjectiveId: string,
  completedObjectiveIds: Set<string>,
): Promise<boolean> {
  const accepted = await offersByStatus(service, env.adventureId, ['accepted'])
  let completed = false
  for (const offer of accepted) {
    if (!offer.contract_id || offer.paid_at) continue
    const contract = await loadContract(service, env.adventureId, offer.contract_id)
    const objectiveIds = contract?.objective_ids ?? []
    if (objectiveIds.length === 0 || !objectiveIds.includes(completedObjectiveId)) continue
    if (!objectiveIds.every((id) => completedObjectiveIds.has(id))) continue
    const result = await completeQuest(service, env, sessionId, offer.id)
    if (result.status === 200) completed = true
  }
  return completed
}
