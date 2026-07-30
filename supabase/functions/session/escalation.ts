// Rung delivery for the Progress Director (overhaul Phase 3). The three old ladders'
// content survives here - the re-frame/orient prompts came from the stuck-hint ladder, the
// "someone arrives / a way forward opens" promotions from the dead-table promoter, and the
// world-moves beat from the idle nudge - but they are now rungs of ONE ladder with one set
// of counters, instead of three detectors that could each fire independently and none of
// which could move the spine.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import { activeLoop, pickReveal, resolveNpcNames, stageableNpcs } from '../_shared/story/index.ts'
import type { DirectorDecision, NpcStageRow, RevealCandidate } from '../_shared/story/index.ts'
import type { GameState, Json, OfferBannerView } from '../_shared/state/index.ts'
import type { AgentEnv } from './agents.ts'
import { loadLoops } from './beats.ts'
import { openSkillChallengeFromSpec } from './encounters.ts'
import { narrationBeat } from './narration.ts'
import { startSocial } from './social-staging.ts'
import { runHookWeaverLive, runStallPromoter } from './story-agents.ts'
import { nodePull } from './canon.ts'
import { logEvent } from './util.ts'

/**
 * Where the party stands - grounds every rung prompt.
 *
 * NO QUEST TITLE (2026-07-30). This used to end `Current goal: ${objective}.` and quote the
 * encounter's label, and both of those strings ARE the objective title - stage 5 sets
 * `encounter.label = objective.title`. So every escalation rung handed the narrator the exact text
 * we spend the rest of the pipeline keeping out of prose, and the narrator pasted it.
 *
 * That is what made the leak count untrackable rather than improving. Run 13b7c386 shipped ten
 * trailing labels where d3f20788 shipped none, with the same code for the paths I had fixed - all
 * ten carrying `pull_present: true`, so the PULL line was working and the title was arriving from
 * here instead. Rungs fire when a party stalls, so the count was measuring how much the party
 * stalled. The zero in the previous run was luck, not a fix.
 *
 * The authored `pull` says the same thing as a situation rather than a task, which is the whole
 * point of it existing. Stakes survive because they are authored prose, not a label.
 */
function situation(state: GameState, pull: string): string {
  const enc = state.encounter
  return [
    `Scene: ${state.scene.locationName || 'unknown'} (${state.scene.mode}).`,
    pull ? `Unresolved: ${pull}` : '',
    enc
      ? `They are mid-${enc.kind.replaceAll('_', ' ')}${enc.stakes ? ` - at stake: ${enc.stakes}` : ''}.`
      : '',
  ].filter(Boolean).join(' ')
}

/**
 * A clue the party could plausibly run into RIGHT HERE.
 *
 * This used to take the first undiscovered ingredient in table order, wherever it lived. Live
 * 2026-07-26 that surfaced a clue placed in the foreman's office while the party stood at the mine
 * entrance, and the narrator - handed the text - stated it as observed fact: "Veil's knowing hand
 * has clearly doubled the collected sums", with no ledger, no office and no Veil in the scene. A
 * later reveal did the same with the adventure's central twist.
 *
 * Placement is authored, so use it: prefer clues bound to where the party actually is, then
 * unplaced ones (which can surface anywhere), and never one bound to somewhere else.
 */
async function undiscoveredReveal(
  service: SupabaseClient,
  adventureId: string,
  locationId: string | null,
): Promise<string | null> {
  const { data } = await service
    .from('ingredients')
    .select('reveals, placement')
    .eq('adventure_id', adventureId)
    .eq('discovered', false)
    .not('reveals', 'is', null)
  // Selection rule lives in _shared/story/reveals.ts so it is unit-tested (nothing under
  // supabase/functions has a test runner). See the module header for the leak it prevents.
  return pickReveal((data ?? []) as RevealCandidate[], locationId)
}

export async function deliverRung(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
  decision: DirectorDecision,
  pendingOffer: OfferBannerView | null,
): Promise<void> {
  // The authored situation, in place of the quest title this used to carry - see `situation`.
  const ground = situation(
    state,
    await nodePull(
      service, env.adventureId,
      state.objectives?.currentId ?? null,
      state.dm?.encounterSpec?.nodeKey ?? null,
    ).catch(() => ''),
  )
  const opener = 'The party has been circling without progress - the DM leans in, in the fiction.'

  if (decision.action === 'offer_pressure') {
    // The giver presses. Not a hint: the story has been OFFERED and nothing can progress until
    // it is answered, which is how 35 of 50 turns passed with an open offer (live 2026-07-22).
    await narrationBeat(
      service, env, sessionId,
      `${ground} ${pendingOffer?.giverName ?? 'The one who made the offer'} is still waiting on an ` +
        `answer about "${pendingOffer?.label ?? 'the job'}"${pendingOffer?.stakes ? ` - ${pendingOffer.stakes}` : ''}. ` +
        // THE PRICE IS CANON, SO SAY IT (2026-07-29). This asked the giver to "restate what it is
        // worth" without ever telling it what that was, so the narrator invented a figure. Live run
        // a6ed7df4: Rosa Kell offered "forty gold" at narration #0, the director pressed at #4 and
        // she said "twenty silver each", pressed again at #6 - "twenty silver" - and then paid out
        // forty gold at #14, because the PAYOUT reads the staged offer and the press did not.
        //
        // The number has always been on the offer. The speaker was simply never handed it.
        (typeof pendingOffer?.gold === 'number' && pendingOffer.gold > 0
          ? `The agreed price is ${pendingOffer.gold} gold - state it EXACTLY, never a different figure or currency. `
          : '') +
        // DO NOT RE-DELIVER THE PITCH (2026-07-29). This used to say "restate what they need and
        // what it is worth", and the narrator did exactly that: run abd318e1 re-published Netta's
        // entire opening speech, word for word, at press 1 and again at press 2. The offer's need
        // and its price are already on the player's screen in the banner, and the original pitch is
        // still in the transcript window - a press only has to make WAITING hurt.
        'Have them press for a decision NOW, in character. Do NOT restate the pitch or re-explain ' +
        'what they want and what it pays - the party has heard it and it is still on their screen. ' +
        'Say something NEW: what waiting has already cost, what is moving while they hesitate, what ' +
        'this person is starting to think of them. End by asking plainly whether they are in, and ' +
        'never answer for them.' +
        (decision.presses && decision.presses > 1
          ? ` This is press ${decision.presses}: they have asked before and been met with silence, ` +
            'so let that show - shorter, harder, and closer to walking away than last time.'
          : ''),
      'The offer presses',
    )
    return
  }

  if (decision.action === 'nudge') {
    // Rung 1 - re-frame: re-see the obstacle and its stakes vividly, NO new information.
    await narrationBeat(
      service, env, sessionId,
      `${opener} ${ground} Re-frame the situation they are stuck on: make the obstacle and what ` +
        'hangs on it vivid and concrete again, WITHOUT revealing anything new or naming a ' +
        'skill/mechanic. End by putting the decision back in their hands.',
      'Director: re-frame',
    )
    return
  }

  if (decision.action === 'reveal') {
    // Rung 2 - orient: surface an existing, undiscovered clue as an in-fiction detail.
    let seed = await undiscoveredReveal(service, env.adventureId, state.scene.locationId ?? null)
    if (!seed) {
      const objective = state.objectives.list.find((o) => o.id === state.objectives.currentId)?.title
      const loop = activeLoop(await loadLoops(service, env.adventureId))
      const { data: beat } = loop?.currentBeatId
        ? await service.from('beats').select('name').eq('id', loop.currentBeatId).maybeSingle()
        : { data: null }
      const hooks = objective
        ? await runHookWeaverLive(
            env, { title: objective, hiddenDescription: '' },
            (beat?.name as string) ?? 'the current situation', ground,
          ).catch(() => [])
        : []
      seed = hooks[0]?.textSeed ?? null
    }
    await narrationBeat(
      service, env, sessionId,
      `${opener} ${ground} Draw their attention to something already here that points a way ` +
        `forward - a detail they can act on, a companion's passing thought, a half-remembered ` +
        `fact.${seed
          ? ` Point them toward this WITHOUT stating it: "${seed}". That sentence is the DM's ` +
            'private note, not something anyone in the scene knows or says. Give the party only ' +
            'the physical trace of it that is present right now - a mark, a sound, a smell, an ' +
            'object, someone\'s slip of the tongue - and let them draw the conclusion themselves. ' +
            'NEVER assert the note as fact, and never describe a person, place or object that is ' +
            'not in this scene.'
          : ''} Deliver it in the fiction, ` +
        'never as instructions, and leave the next move to them.',
      'Director: orient',
    )
    return
  }

  // Rungs 4/5 (guaranteed_route, fail_forward) are Phase 4; the director gates them off until
  // then, so reaching here means a new rung was added without delivery. Say something rather
  // than silently doing nothing.
  await narrationBeat(
    service, env, sessionId,
    `${opener} ${ground} The world moves for them: let ONE concrete development open a clear way ` +
      'forward - an arrival, a change in the scene, a path revealed - that hands them an obvious ' +
      'next thing to engage. End at that new opening.',
    'Director: opening',
  )
}

/**
 * The one gap a beat re-plan cannot close: an active objective with NO active loop (the quest
 * loop completed, or a pivot left the stack empty). There is no beat to re-plan, so the
 * promoter - which reads what the party has actually been reaching for - opens something.
 * It writes no progression by design; the normal encounter machinery takes it from there.
 */
export async function promoteOpening(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
): Promise<boolean> {
  const [{ data: npcRows }, { data: inputRows }] = await Promise.all([
    service.from('npcs').select('id, name, generated, initial_state').eq('adventure_id', env.adventureId),
    service.from('event_log').select('payload').eq('adventure_id', env.adventureId)
      .eq('type', 'intent_submitted').order('id', { ascending: false }).limit(8),
  ])
  const staged = new Set(state.dialogue.speakers.map((sp) => sp.npcId))
  const roster: NpcStageRow[] = ((npcRows ?? []) as {
    id: string; name: string; initial_state?: string | null; generated?: boolean | null
  }[]).map((n) => ({ id: n.id, name: n.name, initialState: n.initial_state, generated: n.generated }))
  const candidates = stageableNpcs(roster, state.dm?.facts.npcStates ?? {}, {
    excludeIds: [...staged].filter((id): id is string => Boolean(id)),
    namedOnly: true,
  })
  const recentInputs = ((inputRows ?? []) as { payload: Record<string, Json> }[])
    .map((e) => String(e.payload.text ?? '')).filter(Boolean).reverse()
  if (recentInputs.length === 0) return false

  const loop = activeLoop(await loadLoops(service, env.adventureId))
  const opening = await runStallPromoter(env, {
    recentInputs,
    sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode}), day ${state.scene.day}`,
    hook: null,
    npcNames: candidates.map((n) => n.name),
    loopType: loop?.type ?? 'custom',
  }).catch(() => null)
  if (!opening || opening.action === 'none') return false

  if (opening.action === 'stage_npc') {
    const { ids } = resolveNpcNames(opening.npcNames, candidates)
    if (ids.length === 0) return false
    const result = await startSocial(service, env.adventureId, env.creatorId, ids)
    if (result.status !== 200) return false
    await logEvent(service, env.adventureId, sessionId, 'stall_promoted', {
      action: 'stage_npc', npcs: opening.npcNames as unknown as Json, why: opening.why,
    })
    await narrationBeat(
      service, env, sessionId,
      `The party has been circling with nobody to turn to. ${opening.npcNames.join(' and ')} ` +
        `arrives or is found - ${opening.why || 'exactly who they have been asking about'}. ` +
        'Bring them into the scene in one or two sentences and let them speak first, leaving the ' +
        'next move to the party.',
      'Someone arrives',
    )
    return true
  }

  const encounter = await openSkillChallengeFromSpec(service, env, sessionId, {
    kind: 'skill_challenge',
    label: opening.label || 'The way forward',
    stakes: opening.why,
    params: {},
    // No outcome map: a promoted opening must not hand out progression it did not author.
    onSuccess: [], onPartial: [], onFailure: [],
  })
  await logEvent(service, env.adventureId, sessionId, 'stall_promoted', {
    action: 'open_encounter', label: encounter.label, why: opening.why,
  })
  await narrationBeat(
    service, env, sessionId,
    `The party has been circling. Make "${encounter.label}" concrete and immediate in front of ` +
      `them - ${opening.why || 'the thing they have been reaching for'} - and end demanding ` +
      'their first move against it.',
    'A way forward opens',
  )
  return true
}

/** Player-requested "get your bearings" - the same rung-2 content, on demand. */
export async function deliverRequestedHint(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  state: GameState,
): Promise<void> {
  await deliverRung(
    service, env, sessionId, state,
    { action: 'reveal', rung: 2, reason: 'player asked' },
    null,
  )
}
