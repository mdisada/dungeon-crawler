// Entry mapping (encounter-states 4.1): the cutscene phase's single handler. While no
// encounter is open, every full-AI say/do lands here - the mapper classifies the reply as
// engaging the offered encounter, an off-script endeavor (ad-hoc micro-encounter via the
// Encounter Designer), or trivial color folded into the next cutscene block. Cutscene inputs
// never silently vanish, and nothing here writes progression - outcome maps own that.

import type { SupabaseClient } from 'npm:@supabase/supabase-js@2'

import type { Json } from '../_shared/state/index.ts'
import { runEntryMapper } from './agents.ts'
import type { AgentEnv, EntryKind, SceneEffects } from './agents.ts'
import { loadLoops, planAndOpenBeat } from './beats.ts'
import { activeLoop, seeksInformation } from '../_shared/story/index.ts'
import { discoverAtLocation, discoveryNote } from './discovery.ts'
import {
  handleChallengeIntent, openSkillChallengeFromSpec, parseStoredBeatSpec, runCombatPlaceholderEncounter,
} from './encounters.ts'
import type { StoredBeatSpec } from './encounters.ts'
import { narrationBeat } from './narration.ts'
import { endEncounter, startSocial } from './social-staging.ts'
import { openPuzzleFromSpec } from './puzzle-encounter.ts'
import {
  agentContextLines, appendLinesDiff, characterProfiles, loadPartyCharacters, newLine,
  partyProfileLines, partySkillList, typingDiff,
} from './orchestrate.ts'
import type { CharacterRow } from './orchestrate.ts'
import { recordProposal } from './proposals.ts'
import { applySceneEffects } from './scene-director.ts'
import { setScene } from './state.ts'
import { openSocialEncounter } from './social-encounter.ts'
import { runAdhocDesigner } from './story-agents.ts'
import { noteSuspicion } from './steward.ts'
import { assertOk, commitDiffs, loadState, logEvent } from './util.ts'

/** The open beat's stored spec, or null when the beat degraded to ad-hoc entries only. */
export async function openBeatSpec(
  service: SupabaseClient,
  adventureId: string,
): Promise<{ beatId: string | null; spec: StoredBeatSpec | null; nodeId: string | null }> {
  const loop = activeLoop(await loadLoops(service, adventureId))
  if (!loop?.currentBeatId) return { beatId: null, spec: null, nodeId: null }
  const { data, error } = await service
    .from('beats')
    .select('id, status, encounter_spec, node_id')
    .eq('id', loop.currentBeatId)
    .maybeSingle()
  assertOk(error, 'beat load failed')
  if (!data || data.status !== 'active') return { beatId: null, spec: null, nodeId: null }
  const spec = parseStoredBeatSpec((data.encounter_spec ?? null) as Json)
  const nodeId = (data.node_id as string | null) ?? null

  // A SCENE THAT HAS BEEN PLAYED IS NOT ON OFFER (2026-07-28).
  //
  // `openBeatSpec` served the beat's spec for as long as the beat was `active`, with no regard for
  // whether that scene had already been resolved - so every `offered` entry re-opened it. Combat is
  // where it showed: the placeholder opens AND resolves inside one turn, so `state.encounter` is
  // null again immediately, the next input routes back here, and the fight runs again.
  //
  // Live 2026-07-27: the climax combat opened NINE times and the engine returned defeat every time,
  // 11 of 18 encounter opens in the run were re-opens, and a COMBAT_BUDGET of 3 delivered 11. Worse
  // than the repetition, it starved the navigator - each re-open re-resolved the same node, so
  // `lastResolvedNode` kept answering "#n0 failed" and the authored failure edge to the other two
  // ways in was never followed. The party lost one fight ten times instead of finding another route.
  //
  // Returning null hands the turn to the existing `offered -> fold_in` downgrade below, and route
  // health then reads the beat as `spent` and re-plans it - which is exactly the designed recovery.
  if (spec?.nodeKey) {
    const { data: played } = await service
      .from('event_log')
      .select('id')
      .eq('adventure_id', adventureId)
      .eq('type', 'encounter_resolved')
      .eq('payload->>node_key', spec.nodeKey)
      .limit(1)
    if ((played ?? []).length > 0) return { beatId: data.id as string, spec: null, nodeId }
  }
  return { beatId: data.id as string, spec, nodeId }
}

/**
 * Has the scene the party is entering ALREADY been narrated as it opened? (2026-07-28)
 *
 * A beat opening and an entry narration describe the same moment from two sides - "here is the
 * scene" and "the party commits to it" - and normally they are separated by the player reading and
 * deciding. They are not when the beat opens in the TAIL of the previous turn, because the tail
 * runs in its own worker while the next request is already in flight. Both then narrate at once:
 *
 *   12:09:15  intent_submitted "Give me the ledger, Vane."
 *   12:09:15  beat_opened      trigger=objective_completed      (previous turn's tail)
 *   12:09:30  narration        "The ledger passes from Vane's shaking hands to Kestrel's"
 *   12:09:33  narration        "Vane's grip tightens - then he thrusts the ledger into her hands"
 *
 * The handover twice, three seconds apart. Two of the three duplicate pairs in run 6d9b2aeb are
 * exactly this; the third comes from a check outcome racing a beat opening and is NOT covered here.
 *
 * Deterministic and narrow: the same node, opened moments ago, whose own opening narration has
 * already introduced the scene. The encounter still opens - only the second description is
 * dropped, because the first one is better (it carries the authored seed and the stakes).
 *
 * MEASURED FROM THE PLAYER'S INTENT, NOT FROM NOW (2026-07-29).
 *
 * This asked `Date.now() - opened < 90s`, which catches every beat opened in the last minute and a
 * half - including one the player has already READ and is now responding to. That is the opposite
 * of an echo: it is an answer to their action, and dropping it leaves them staring at silence.
 *
 * Measured across nine runs: the guard fired 20 times and in 9 of those the player got no text at
 * all for their turn. Every single firing was on a beat that opened 4.3s to 86.2s BEFORE the
 * player acted - not one was the concurrent case this exists for. The actions swallowed include
 * "I grab the ledger", "I draw my axe and charge the nearest spectral figure", "we head down into
 * the cellar", and - worst - "I turn to face into the black water and shout, 'I offer the phantom
 * ships!'", a climactic declaration answered with nothing.
 *
 * The real discriminator was always in the original evidence and was simply not used: in run
 * 6d9b2aeb the `intent_submitted` and the `beat_opened` share a timestamp. The player could not
 * have read it, because it did not exist when they hit send. So ask exactly that.
 */
/** How far before the intent a beat may open and still count as concurrent with it (clock skew,
 *  and the tail landing while the player was already typing). Deliberately tight: the cost of
 *  being too generous is a silent turn, and the cost of being too strict is one duplicated
 *  description - which is the safe direction. */
const ENTRY_ECHO_GRACE_MS = 2_000

async function sceneAlreadyOpened(
  service: SupabaseClient,
  adventureId: string,
  nodeKey: string | undefined,
  intentAt: number,
): Promise<boolean> {
  if (!nodeKey) return false
  const { data } = await service
    .from('event_log')
    .select('created_at')
    .eq('adventure_id', adventureId)
    .eq('type', 'beat_opened')
    .eq('payload->>node_key', nodeKey)
    .order('created_at', { ascending: false })
    .limit(1)
  const opened = (data ?? [])[0]?.created_at as string | undefined
  if (!opened) return false
  const openedAt = Date.parse(opened)
  if (!Number.isFinite(openedAt)) return false
  return openedAt >= intentAt - ENTRY_ECHO_GRACE_MS
}

/** The authored affordances of the open node - the closed menu the mapper matches against and
 *  the chip list the players see. Empty for legacy guides. */
async function nodeAffordances(
  service: SupabaseClient,
  nodeId: string | null,
): Promise<{ key: string; hint: string }[]> {
  if (!nodeId) return []
  const { data } = await service.from('story_nodes').select('affordances').eq('id', nodeId).maybeSingle()
  const raw = (data?.affordances ?? []) as unknown
  return (Array.isArray(raw) ? raw : []).flatMap((a) => {
    if (typeof a !== 'object' || a === null) return []
    const af = a as Record<string, unknown>
    return typeof af.key === 'string' ? [{ key: af.key, hint: String(af.hint ?? '') }] : []
  })
}

/**
 * The place this beat's scene happens, when the party is NOT there yet - otherwise null.
 *
 * Null covers every "act here" case: a rescue node (deliberately unplaced, it happens wherever the
 * party stands), a legacy guide with no node placement, and the ordinary case of already being in
 * the right room. Only a scene with a location the party has not reached answers with a name.
 */
async function sceneAwaitingArrival(
  service: SupabaseClient,
  adventureId: string,
  beatId: string | null,
): Promise<{ locationId: string; name: string; partyAt: string; partyName: string } | null> {
  if (!beatId) return null
  const { data: beat } = await service.from('beats').select('node_id').eq('id', beatId).maybeSingle()
  const nodeId = (beat?.node_id as string | null) ?? null
  if (!nodeId) return null
  const { data: node } = await service.from('story_nodes').select('location_id').eq('id', nodeId).maybeSingle()
  const locationId = (node?.location_id as string | null) ?? null
  if (!locationId) return null

  const { state } = await loadState(service, adventureId)
  const partyAt = state.scene.locationId ?? ''
  if (!partyAt || partyAt === locationId) return null

  const { data: place } = await service.from('locations').select('name').eq('id', locationId).maybeSingle()
  return {
    locationId,
    name: (place?.name as string | undefined) ?? 'where it happens',
    partyAt,
    partyName: state.scene.locationName || 'where they were',
  }
}

export async function handleCutsceneIntent(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  kind: string,
  opts?: { lineAlreadyStaged?: boolean; affordanceKey?: string | null },
): Promise<{ status: number; body: Record<string, unknown> }> {
  // As close as the server gets to "when the player hit send" - captured before any work, so a
  // slow turn cannot push it past a beat that opened while the turn was running. See
  // sceneAlreadyOpened: this is the reference point the echo test needs.
  const intentAt = Date.now()
  if (!opts?.lineAlreadyStaged) {
    await commitDiffs(service, env.adventureId, (s) => [
      appendLinesDiff(s, [newLine(character.name, null, text)], { typing: true }),
    ])
  }
  if (kind === 'say') {
    // Suspicion tagging (F08 SS8) survives the machine - never blocks the reply.
    try {
      await noteSuspicion(service, env, sessionId, text)
    } catch (err) {
      console.error('suspicion pass failed', err)
    }
  }

  const state = (await loadState(service, env.adventureId)).state
  const { beatId, spec, nodeId } = await openBeatSpec(service, env.adventureId)
  const affordances = await nodeAffordances(service, nodeId)

  // Chip bypass (2026-07-26): an UNEDITED authored choice needs no interpretation at all. The
  // player picked from the scene's own menu, so the mapper - the last open-judgment call left in
  // the cutscene path - is skipped entirely. Editing the text drops the key upstream and this
  // falls through to the mapper as ordinary free text.
  const bypassKey = opts?.affordanceKey && affordances.some((a) => a.key === opts.affordanceKey)
    ? opts.affordanceKey
    : null
  if (bypassKey && spec) {
    const party = await loadPartyCharacters(service, env.adventureId)
    await logEvent(service, env.adventureId, sessionId, 'entry_mapped', {
      entry: 'offered', character_id: character.id, beat_id: beatId, text: text.slice(0, 200),
      affordance_key: bypassKey, via: 'chip',
    })
    try {
      return await executeEntry(
        service, env, sessionId, character, text, 'offered',
        { interpretation: `chose: ${bypassKey}`, sceneEffects: null }, spec, beatId, party, intentAt,
        { alreadyLogged: true },
      )
    } catch (err) {
      await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
      throw err
    }
  }

  const [party, locationRows, npcRows, recentEntryRows] = await Promise.all([
    loadPartyCharacters(service, env.adventureId),
    service.from('locations').select('name').eq('adventure_id', env.adventureId),
    service.from('npcs').select('name').eq('adventure_id', env.adventureId),
    service
      .from('event_log')
      .select('payload')
      .eq('adventure_id', env.adventureId)
      .eq('type', 'entry_mapped')
      .order('id', { ascending: false })
      // Was 3, which is shorter than the stall it exists to notice: the audited runs hold streaks
      // of eight consecutive folds, and a 3-row window cannot count past three of them.
      .limit(12),
  ])
  const recentEntries = (recentEntryRows.data ?? []) as { payload: Record<string, Json> }[]
  // Anti-circling context (playtest 2026-07-20): the mapper sees what it already folded in,
  // so "I walk forward" a second time reads as commitment, never another fold. Still the most
  // RECENT three - a longer list of quoted text dilutes the prompt rather than sharpening it.
  const recentFolds = recentEntries
    .filter((e) => e.payload.entry === 'fold_in' && typeof e.payload.text === 'string')
    .slice(0, 3)
    .map((e) => (e.payload.text as string).slice(0, 100))
  // The stall SHAPE the repeat rule above is blind to: eight different questions in a row circle
  // just as hard as one question asked eight times, and look nothing alike. Rows are newest-first,
  // so this counts back from now until the last reply that was not folded.
  let foldStreak = 0
  for (const e of recentEntries) {
    if (e.payload.entry !== 'fold_in') break
    foldStreak++
  }

  let mapping
  try {
    const profiles = await characterProfiles(service, party)
    mapping = await runEntryMapper(env, {
      text,
      actorSummary: profiles[character.id] ?? `${character.name}, level ${character.level} ${character.class_key ?? 'adventurer'}`,
      sceneSummary: `${state.scene.locationName || 'unknown place'} (${state.scene.mode}), day ${state.scene.day}`,
      hook: spec ? { kind: spec.kind, label: spec.label, stakes: spec.stakes } : null,
      knownLocations: ((locationRows.data ?? []) as { name: string }[]).map((l) => l.name),
      knownNpcs: ((npcRows.data ?? []) as { name: string }[]).map((n) => n.name),
      recentEvents: agentContextLines(state, 5),
      recentFolds,
      foldStreak,
      affordances,
    })
  } catch (err) {
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)])
    throw err
  }
  const entry = mapping.entry === 'offered' && !spec ? 'fold_in' : mapping.entry
  try {
    return await executeEntry(service, env, sessionId, character, text, entry, mapping, spec, beatId, party, intentAt)
  } catch (err) {
    // Never leave the table wedged on typing:true - the machine's cutscene handler is the
    // hot path for every full-AI input.
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
    throw err
  }
}

async function executeEntry(
  service: SupabaseClient,
  env: AgentEnv,
  sessionId: string,
  character: CharacterRow,
  text: string,
  entry: 'offered' | 'adhoc' | 'fold_in',
  mapping: {
    interpretation: string
    sceneEffects: SceneEffects | null
    affordanceKey?: string | null
    /** The mapper's OWN verdict, before the no-spec downgrade below rewrote it. */
    entry?: EntryKind
  },
  spec: StoredBeatSpec | null,
  beatId: string | null,
  party: CharacterRow[],
  /** When the player hit send - the reference point for the echo test. */
  intentAt: number,
  opts?: { alreadyLogged?: boolean },
): Promise<{ status: number; body: Record<string, unknown> }> {
  // The mapper audit trail: the player's RAW text beside the key it was filed under. Misfiled
  // intent (a real off-script move railroaded into an affordance, or an on-script reply bounced
  // to adhoc) is the mapper's remaining failure mode - this is what makes it measurable in the
  // lab instead of anecdotal.
  //
  // `mapper_entry` and `had_offer` are what separate the two very different stories behind a
  // fold (2026-07-29). A fold can mean the MODEL judged the reply to be colour, or it can mean the
  // model said "offered" and the downgrade above rewrote it because no spec was on offer. Those
  // want opposite fixes, and the log recorded neither - answering "which was it?" across six runs
  // needed a three-way join of event_log, beats and encounter_resolved to reconstruct. It is one
  // field. (The answer, for the record: 50 of 78 folds were the model's own call.)
  if (!opts?.alreadyLogged) {
    await logEvent(service, env.adventureId, sessionId, 'entry_mapped', {
      entry, character_id: character.id, beat_id: beatId, text: text.slice(0, 200),
      affordance_key: mapping.affordanceKey ?? null, via: 'mapper',
      mapper_entry: mapping.entry ?? entry, had_offer: spec !== null,
      hook_kind: spec?.kind ?? null,
    })
  }
  await recordProposal(service, {
    adventureId: env.adventureId,
    sessionId,
    type: 'ruling',
    payload: { entry, interpretation: mapping.interpretation } as unknown as Json,
    mode: 'auto',
    blocking: true,
    summary: `entry ${entry}: ${mapping.interpretation.slice(0, 60)}`,
  })

  // World movement rides on the reply (travel to the site, drawing NPCs in, time passing).
  // A non-social encounter is about to open, though, and a staged speaker takes absolute
  // routing priority over it - every subsequent input would become NPC dialogue and starve
  // the challenge (seen live: an NPC staged into a solo search scene). Travel and time still
  // apply; only the staging is dropped.
  let sceneNote = ''
  if (mapping.sceneEffects) {
    const opensNonSocial = entry === 'adhoc' ||
      (entry === 'offered' && spec !== null && ['combat', 'skill_challenge', 'puzzle'].includes(spec.kind))
    const effects = opensNonSocial && mapping.sceneEffects.stageNpcs.length > 0
      ? { ...mapping.sceneEffects, stageNpcs: [] }
      : mapping.sceneEffects
    if (effects !== mapping.sceneEffects) {
      await logEvent(service, env.adventureId, sessionId, 'scene_effect_rejected', {
        effect: 'stage_npcs', proposed: mapping.sceneEffects.stageNpcs, reason: 'non-social encounter opening',
      })
    }
    const applied = await applySceneEffects(service, env, sessionId, effects, {
      stageNpcs: (npcIds) => startSocial(service, env.adventureId, env.creatorId, npcIds),
      endScene: () => endEncounter(service, env.adventureId, env.creatorId),
    })
    if (applied.traveledTo) sceneNote += ` The party has just arrived at ${applied.traveledTo}.`
    if (applied.staged.length > 0) sceneNote += ` Now in conversation: ${applied.staged.join(', ')}.`
    if (applied.dayAdvanced !== null) sceneNote += ' Meaningful time passes.'
  }

  // The beat that opened this very scene may have narrated it moments ago in the previous turn's
  // tail - see sceneAlreadyOpened. When it did, the entry narration is a second description of one
  // event, and the beat's version is the better one (authored seed, stakes, the ask).
  const echoesSceneOpening = entry === 'offered' &&
    await sceneAlreadyOpened(service, env.adventureId, spec?.nodeKey, intentAt)
  if (echoesSceneOpening) {
    await logEvent(service, env.adventureId, sessionId, 'narration_suppressed', {
      reason: 'scene_opening_already_narrated', node_key: spec?.nodeKey ?? null, entry,
    }).catch(() => {})
    // AND LOWER THE FLAG. `publishNarration` is the only thing that clears `typing`, so skipping
    // a narration also skips the unlock - the table is left "the DM is thinking" forever and every
    // later turn 409s. Live on the very first run carrying this suppression: turns 1-28 played,
    // the echo fired at turn 29, and turns 29-50 were rejected without exception, 22 in a row.
    //
    // Any future early return from a narrating path has the same obligation.
    await commitDiffs(service, env.adventureId, () => [typingDiff(false)]).catch(() => {})
  }

  if (entry === 'offered') {
    const offered = spec!
    // YOU CANNOT ACT ON A SCENE YOU HAVE NOT REACHED (2026-07-29).
    //
    // A node carries the place it happens, and openAuthoredNode narrates a "pull" when the party is
    // elsewhere - but it publishes that node's affordances regardless, and this branch then opened
    // the encounter wherever the party happened to be standing. So the prose said they had not
    // travelled while the chips said they could act as though they had.
    //
    // Live run a6ed7df4: the party never travelled to the Harbourmaster's Office, yet Eilam Marsh
    // answered them through the door, met Bram's eyes "through the doorway", and a player typed "I
    // slam my hand on the desk, rattling the ledgers" - all from Pier Nine. `scene_location_diverged`
    // fired, recording the fiction inside a room the state had never entered.
    //
    // Enforced HERE rather than on the chips because free text routes through the same mapper: a
    // chip-only fix is bypassed by typing the action out. Chips are presentation; this is the gate.
    //
    // Resolves as TRAVEL, never as a refusal. Refusing is what killed the Maren beat - the encounter
    // returned null, the beat went stillborn, and the party paid its setback for a scene nobody
    // saw. The beat stays open and its affordances stay valid; the party simply has to arrive first.
    const awaiting = await sceneAwaitingArrival(service, env.adventureId, beatId)
    if (awaiting) {
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'engage_before_arrival', node_key: offered.nodeKey ?? null,
        scene_at: awaiting.name, party_at: awaiting.partyName,
      }).catch(() => {})
      // COMMIT the journey, do not merely describe it. Narrating "they set out" while leaving
      // scene.locationId untouched would send the party straight back here on their next attempt,
      // and the turn after that - a chip that can never be satisfied is worse than one that opens
      // the wrong scene. Engaging a scene IS the decision to go to it; a DM would say "that's
      // across town - you head over", and the node is authored at that place anyway, so this moves
      // the party to somewhere the story already expects them.
      await setScene(service, env.adventureId, env.creatorId, { location_id: awaiting.locationId })
      await logEvent(service, env.adventureId, sessionId, 'scene_travel', {
        location_id: awaiting.locationId, name: awaiting.name, proposed: awaiting.name,
        via: 'engage_before_arrival',
      }).catch(() => {})
      await narrationBeat(
        service, env, sessionId,
        `The party sets out for ${awaiting.name} to act on "${offered.label}", leaving ` +
          `${awaiting.partyName} behind. Narrate the journey and their arrival - but stop at the ` +
          'threshold: do NOT begin the scene itself, and do NOT resolve anything.',
        'Setting out',
      )
      return { status: 200, body: { ok: true, resolved: 'travelled', destination: awaiting.name } }
    }
    if (offered.kind === 'combat') {
      await runCombatPlaceholderEncounter(
        service, env, sessionId, offered,
        `The party commits: ${mapping.interpretation}.${sceneNote}`,
      )
      return { status: 200, body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'combat' } }
    }
    if (offered.kind === 'skill_challenge') {
      const encounter = await openSkillChallengeFromSpec(service, env, sessionId, offered)
      if (!echoesSceneOpening) {
        await narrationBeat(
          service, env, sessionId,
          `The party commits: ${mapping.interpretation}.${sceneNote} The "${offered.label}" challenge ` +
            `begins${offered.stakes ? ` - at stake: ${offered.stakes}` : ''}. Make the situation ` +
            'concrete and end demanding their first move.',
          'Encounter entered',
        )
      }
      return {
        status: 200,
        body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'skill_challenge', encounter_id: encounter.id },
      }
    }
    if (offered.kind === 'social') {
      const encounter = await openSocialEncounter(
        service, env, sessionId, offered,
        (npcIds) => startSocial(service, env.adventureId, env.creatorId, npcIds),
      )
      if (encounter) {
        await narrationBeat(
          service, env, sessionId,
          `The party engages: ${mapping.interpretation}.${sceneNote} The conversation ` +
            `("${offered.label}")${offered.stakes ? ` - at stake: ${offered.stakes} -` : ''} is now ` +
            'face to face. Set the scene in one or two sentences and let the NPC open, waiting on the party.',
          'Encounter entered',
        )
        return {
          status: 200,
          body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'social', encounter_id: encounter.id },
        }
      }
      // STILLBORN beat (Phase 2 defense-in-depth): plan-time resolution should make this
      // unreachable, but if the cast died between planning and engaging, falling through to an
      // ad-hoc challenge with EMPTY outcome maps is how the story became unwinnable - the beat
      // never opened its own encounter, so it could never be "spent", so nothing re-planned it
      // (live 2026-07-22). Force a re-plan instead: the loop gets a beat it can actually play.
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'beat_stillborn', label: offered.label, beat_id: beatId,
      })
      const loop = activeLoop(await loadLoops(service, env.adventureId))
      if (loop) {
        try {
          await planAndOpenBeat(service, env, sessionId, loop.id, 'stillborn')
          return { status: 200, body: { ok: true, resolved: 'beat_replanned', reason: 'stillborn' } }
        } catch (err) {
          console.error('stillborn re-plan failed', err)
        }
      }
      // Re-plan unavailable: fall through to ad-hoc structure below rather than stall.
    }
    if (offered.kind === 'puzzle') {
      const encounter = await openPuzzleFromSpec(service, env, sessionId, offered)
      await narrationBeat(
        service, env, sessionId,
        `The party engages: ${mapping.interpretation}.${sceneNote} The puzzle ("${offered.label}")` +
          `${offered.stakes ? ` - at stake: ${offered.stakes} -` : ''} now stands before them. ` +
          'Describe what they can see and manipulate WITHOUT hinting at the solution, and end ' +
          'demanding their first idea.',
        'Encounter entered',
      )
      return {
        status: 200,
        body: { ok: true, resolved: 'encounter_entered', encounter_kind: 'puzzle', encounter_id: encounter.id },
      }
    }
    if (!['combat', 'skill_challenge', 'social', 'puzzle'].includes(offered.kind)) {
      await logEvent(service, env.adventureId, sessionId, 'incident', {
        kind: 'encounter_kind_unimplemented', encounter_kind: offered.kind, beat_id: beatId,
      })
    }
  }

  if (entry === 'adhoc' || (entry === 'offered' && spec && !['combat', 'skill_challenge'].includes(spec.kind))) {
    const design = await runAdhocDesigner(env, mapping.interpretation, {
      size: party.length,
      skills: partySkillList(party),
      profiles: await partyProfileLines(service, party),
    })
    const adhocSpec: StoredBeatSpec = {
      kind: design.kind,
      label: design.label,
      stakes: design.stakes,
      params: (typeof design.params === 'object' && design.params !== null && !Array.isArray(design.params)
        ? design.params
        : {}) as Record<string, Json>,
      // Ad-hoc encounters carry no outcome map - agency without spine-skipping.
      onSuccess: [],
      onPartial: [],
      onFailure: [],
    }
    if (adhocSpec.kind === 'combat') {
      await runCombatPlaceholderEncounter(
        service, env, sessionId, adhocSpec,
        `The party commits: ${mapping.interpretation}.${sceneNote}`,
      )
      return { status: 200, body: { ok: true, resolved: 'adhoc_encounter', encounter_kind: 'combat' } }
    }
    const encounter = await openSkillChallengeFromSpec(service, env, sessionId, adhocSpec)
    // The off-script reply IS the endeavor - it doubles as the first attempt.
    const first = await handleChallengeIntent(service, env, sessionId, character, text, { lineAlreadyStaged: true })
    return {
      status: 200,
      body: { ok: true, resolved: 'adhoc_encounter', encounter_kind: 'skill_challenge', encounter_id: encounter.id, next: first.body.resolved ?? null },
    }
  }

  // ASKING AND LOOKING ARE PLAY, AND MUST BE ABLE TO PAY (2026-07-29).
  //
  // Audited across six runs, 76% of mapped intents fold (78 of 102) - and 64% of those folds
  // happened with a live encounter spec on offer, so this is the mapper's own verdict, not the
  // `offered && !spec` downgrade above. Reading what was folded says why: 37% are questions about
  // the fiction and 35% are examinations. The mapper is RIGHT about all of them; they change
  // nothing about where the party stands. The taxonomy is what has no room for them, so the
  // commonest thing players do in a cutscene wrote nothing and the Progress Director ended up
  // driving the story alone (in ac78e517: 16 player intents, 9 director actions, 0 objectives).
  //
  // So consult the location reveal gate the same way a successful search does. Everything that
  // makes that gate safe still applies unchanged - it refuses clues placed anywhere but this
  // room, refuses already-discovered ones, honours affinity binding, and hands back at most one.
  // What differs is only the entitlement: the deliberate act of examining the authored room IS
  // the attempt. `ingredient_revealed` is already spine progress, so a question that lands now
  // resets the stall counters the same as any other real move.
  //
  // Best-effort throughout: a clue that fails to surface must never cost the player their turn.
  let discoveryFragment = ''
  if (seeksInformation(text)) {
    try {
      const { state: now } = await loadState(service, env.adventureId)
      const reveals = await discoverAtLocation(
        service, env, sessionId,
        { locationId: now.scene.locationId ?? null, actorCharacterId: character.id, checkPassed: true },
        'cutscene_inquiry',
      )
      discoveryFragment = discoveryNote(reveals)
    } catch (err) {
      console.error('cutscene inquiry discovery failed', err)
    }
  }

  // fold_in: the action happens and CARRIES the party forward - a folded reply must never
  // read as the story circling back to a question already answered (playtest 2026-07-20).
  await narrationBeat(
    service, env, sessionId,
    `Carry this forward: ${character.name} - ${text}. Let it actually happen and MOVE the ` +
      `scene with it - describe what changes as they act.${sceneNote}${discoveryFragment} Never re-ask a question ` +
      'the party already answered and never re-offer directions they already chose; if the ' +
      'fiction has one way onward, take them along it and give the in-fiction reason it is ' +
      'the way.' +
      (spec
        ? ` Their momentum should land them at the threshold of "${spec.label}"` +
          `${spec.stakes ? ` (at stake: ${spec.stakes})` : ''} - end there, demanding engagement ` +
          'with it, not another choice of direction.'
        : ' End at the next concrete thing demanding their response - never a menu of paths.'),
    'Cutscene',
    'outcome',
  )
  return { status: 200, body: { ok: true, resolved: 'folded_in' } }
}
