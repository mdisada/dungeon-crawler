// Phase 6 slice 1 live integration suite (F08 SS2.1/SS2.2) against the real project:
//   - entry gating: with an unaccepted entry contract, session start stages the offer and the
//     first objective stays hidden (no presumed motivation)
//   - offer lifecycle: unrelated talk falls through; negotiate rolls a bounded persuasion
//     check (terms never exceed the authored ceiling); decline is honored (disposition shift,
//     event, banner cleared); re-weave escalates with reweave_count; any PC's clear accept
//     binds the party (loop pushed, objective activated, journal updated)
//   - encounter machine (encounter-states Slice 3): the opened beat carries a canned
//     encounter spec; an "offered" reply enters it, attempts drive it to a tier, the outcome
//     map applies milestones, and the beat exits - the $0 spine lifecycle
//   - ledger payout: complete_quest pays exactly once (second call 409s), balance lands in
//     players.gold and the ledger_credited event
//   - RLS: players read no quest_offers/core_loops rows directly
//   - $0 spend: the whole suite runs on a demo adventure with canned agents (usage_log empty)
//
// Creates throwaway users/rows and deletes them at the end; safe to re-run.
// Usage: node tests/integration/story-live.mjs
// Requires: VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (frontend/.env.local),
//           SUPABASE_SERVICE_ROLE_KEY (backend/.env), the `session` function deployed,
//           migration 20260718150000 applied.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

function readEnvVar(path, name) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(new RegExp(`^${name}="?(.+?)"?$`, 'm'))
  if (!match) throw new Error(`${name} not found in ${path}`)
  return match[1].trim()
}

const url = readEnvVar('frontend/.env.local', 'VITE_SUPABASE_URL')
const anonKey = readEnvVar('frontend/.env.local', 'VITE_SUPABASE_PUBLISHABLE_KEY')
const serviceKey = readEnvVar('backend/.env', 'SUPABASE_SERVICE_ROLE_KEY')
const password = `Test-password-${Date.now()}!`

const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }

async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST',
    headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}

async function deleteUser(id) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin })
}

async function signIn(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign in failed: ${res.status}`)
  return body.access_token
}

async function restAs(token, method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: anonKey, Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json', Prefer: 'return=representation',
    },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const text = await res.text()
  let body = null
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  return { status: res.status, body }
}

async function serviceRest(method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method,
    headers: { ...admin, Prefer: 'return=representation' },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  })
  const body = await res.json().catch(() => null)
  if (!res.ok) throw new Error(`service ${method} ${path} failed: ${res.status} ${JSON.stringify(body)}`)
  return body
}

async function act(token, payload) {
  const res = await fetch(`${url}/functions/v1/session`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const body = await res.json().catch(() => ({}))
  return { status: res.status, body }
}

const stamp = Date.now()
const emails = { gm: `p6-gm-${stamp}@example.com`, p2: `p6-p2-${stamp}@example.com` }
const userIds = {}
let pass = 0

function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` -- ${JSON.stringify(detail)}` : ''}`)
  pass++
  console.log(`  ok: ${label}`)
}

async function usageCount(advId) {
  const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=id`)
  return rows.length
}

async function eventsOf(advId, type) {
  return serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.${type}&select=payload&order=id.asc`)
}

async function resyncState(token, advId) {
  const res = await act(token, { action: 'resync', adventure_id: advId })
  return res.body.state
}

async function rollOutPending(gm, roller, advId) {
  const state = await resyncState(gm, advId)
  const prompt = state.dialogue.pending
  assert.ok(prompt, 'expected a pending prompt to roll')
  return act(roller, { action: 'roll_pending', adventure_id: advId, prompt_id: prompt.id })
}

async function main() {
  for (const [key, email] of Object.entries(emails)) userIds[key] = await createConfirmedUser(email)
  const gm = await signIn(emails.gm)
  const p2 = await signIn(emails.p2)
  await serviceRest('POST', 'user_settings?on_conflict=user_id', {
    user_id: userIds.gm, provider: 'openrouter',
  }).catch(() => {})
  console.log('setup: users created')

  // Full-AI demo adventure with an entry quest contract; canned agents, zero spend.
  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.gm, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'Phase 6 story test', status: 'guide_ready', demo: true,
    title: 'P6 Story Test', meta_loop: { premise: 'A fishing village and a missing ferry.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'Chapter', arc_summary: 'arc', status: 'active',
  })
  // Both objectives hidden: the entry offer gates activation (F08 SS9).
  const [objective] = await serviceRest('POST', 'objectives', {
    adventure_id: advId, chapter_id: chapter.id, index: 0, title: 'Reach the coast',
    hidden_description: 'The ferry was taken upriver.', reveal_state: 'hidden',
    completion_predicates: { all: [{ flag: 'coast_reached', eq: true }] },
  })
  const [maren] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Elder Maren', role: 'npc',
    personality: { summary: 'weary, warm' }, description: 'The village elder.', faction: 'village',
  })
  const [tobbin] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Old Tobbin', role: 'npc',
    personality: { summary: 'gruff' }, description: 'The late ferryman.', faction: 'village',
  })
  // Candidate endings with closed-vocabulary signals (F08 SS8.1 scoring fixture).
  await serviceRest('POST', 'endings', [
    {
      adventure_id: advId, index: 0, title: 'Safe Passage', description: 'The coast is reached in time.',
      climax_summary: 'illustrative sketch', tone: 'hopeful',
      trigger_conditions: { summary: '', signals: [{ when: { objective_id: objective.id, outcome: 'completed' }, weight: 3, note: '' }] },
      exclusivity_group: 'main',
    },
    {
      adventure_id: advId, index: 1, title: 'The Road Claims All', description: 'The escort fails on the road.',
      climax_summary: 'illustrative sketch', tone: 'tragic',
      trigger_conditions: { summary: '', signals: [{ when: { npc_id: maren.id, state: 'dead' }, weight: 4, note: '' }] },
      exclusivity_group: 'main',
    },
  ])
  // One undiscovered pool clue: the Beat Planner must reuse it before generating (F08 SS5).
  await serviceRest('POST', 'ingredients', {
    adventure_id: advId, chapter_id: chapter.id, type: 'clue',
    content: { text: 'wheel ruts leading upriver' }, reveals: 'the ferry went upriver, not out to sea',
    placement: {}, pillar_tags: ['exploration'],
  })
  const [contract] = await serviceRest('POST', 'quest_contracts', {
    adventure_id: advId, chapter_id: chapter.id, label: 'Escort Maren to the coast',
    giver_npc_id: maren.id, is_entry: true,
    reward: { gold_floor: 50, gold_ceiling: 100, extras: [] },
    stakes: 'The village fades, one dreamer at a time.',
    objective_ids: [objective.id],
  })

  const [gmChar] = await serviceRest('POST', 'characters', {
    user_id: userIds.gm, name: 'Ash', level: 1, is_complete: true,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 14 },
    skill_proficiencies: ['athletics', 'persuasion'], hp_max: 12, hp_current: 12,
  })
  const [p2Char] = await serviceRest('POST', 'characters', {
    user_id: userIds.p2, name: 'Bryn', level: 1, is_complete: true,
    abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 20, cha: 10 },
    skill_proficiencies: ['insight', 'athletics'], hp_max: 10, hp_current: 10,
  })

  console.log('\n[lobby -> session with entry gating]')
  ok('activate', (await act(gm, { action: 'activate', adventure_id: advId })).status === 200)
  const [{ invite_code: invite }] = await serviceRest('GET', `adventures?id=eq.${advId}&select=invite_code`)
  ok('p2 joins', (await act(p2, { action: 'join', invite_code: invite })).status === 200)
  ok('gm picks', (await act(gm, { action: 'pick_character', adventure_id: advId, character_id: gmChar.id })).status === 200)
  ok('p2 picks', (await act(p2, { action: 'pick_character', adventure_id: advId, character_id: p2Char.id })).status === 200)
  ok('gm ready', (await act(gm, { action: 'ready', adventure_id: advId, ready: true })).status === 200)
  ok('p2 ready', (await act(p2, { action: 'ready', adventure_id: advId, ready: true })).status === 200)
  const started = await act(gm, { action: 'start_session', adventure_id: advId })
  ok('session starts', started.status === 200, started.body)

  let state = await resyncState(gm, advId)
  ok('entry offer staged at session start', state.objectives.offers.length === 1, state.objectives.offers)
  ok('offer banner carries giver + floor gold', state.objectives.offers[0].giverName === 'Elder Maren' && state.objectives.offers[0].gold === 50, state.objectives.offers[0])
  // Merge-patch null deletes the key, so "no current objective" reads back as absent.
  ok('first objective NOT active before acceptance', !state.objectives.currentId && state.objectives.list.length === 0, state.objectives)
  const [objRow0] = await serviceRest('GET', `objectives?id=eq.${objective.id}&select=reveal_state`)
  ok('objective row still hidden', objRow0.reveal_state === 'hidden')
  ok('offer system line landed', state.dialogue.lines.some((l) => l.text.startsWith('Offer: Escort Maren')), state.dialogue.lines.map((l) => l.text))
  const offerId = state.objectives.offers[0].id

  console.log('\n[unrelated talk falls through]')
  const question = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'A strange village, this.' })
  ok('unrelated say falls past the offer classifier into entry mapping (folded in)', question.status === 200 && question.body.resolved === 'folded_in', question.body)

  console.log('\n[negotiation: bounded haggling]')
  const haggle = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Pay us more and we have a deal.' })
  ok('negotiate prompts a persuasion check', haggle.status === 200 && haggle.body.resolved === 'check_prompted' && haggle.body.skill === 'persuasion', haggle.body)
  const haggleRoll = await rollOutPending(gm, gm, advId)
  ok('negotiation roll resolves', haggleRoll.status === 200, haggleRoll.body)
  const negotiated = await eventsOf(advId, 'offer_negotiated')
  ok('negotiation event logged with bounded outcome', negotiated.length === 1 && negotiated[0].payload.to >= 50 && negotiated[0].payload.to <= 100, negotiated)
  state = await resyncState(gm, advId)
  const goldAfterHaggle = state.objectives.offers[0].gold
  ok('banner gold matches negotiated terms (within bounds)', goldAfterHaggle >= 50 && goldAfterHaggle <= 100, goldAfterHaggle)
  const [offerRow1] = await serviceRest('GET', `quest_offers?id=eq.${offerId}&select=status,terms`)
  ok('offer still open after haggling', offerRow1.status === 'offered' && offerRow1.terms.gold === goldAfterHaggle)

  console.log('\n[decline honored -> re-weave escalates]')
  const decline = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We refuse the job. Find someone else.' })
  ok('clear refusal declines the offer', decline.status === 200 && decline.body.resolved === 'offer_declined', decline.body)
  state = await resyncState(gm, advId)
  ok('banner cleared on decline', state.objectives.offers.length === 0)
  ok('decline system line landed', state.dialogue.lines.some((l) => l.text.startsWith('Offer declined:')))
  const declineEvents = await eventsOf(advId, 'offer_declined')
  ok('decline event logged', declineEvents.length === 1)
  const [disp] = await serviceRest('GET', `npc_dispositions?npc_id=eq.${maren.id}&character_id=eq.${p2Char.id}&select=value`)
  ok('giver disposition shifted down for the decliner', disp && disp.value <= -1, disp)

  const playerReweave = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'stage_offer', contract_id: contract.id })
  ok('players cannot stage offers', playerReweave.status === 403)
  const reweave = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'stage_offer', contract_id: contract.id })
  ok('re-weave stages a fresh offer', reweave.status === 200, reweave.body)
  const [reweaveRow] = await serviceRest('GET', `quest_offers?adventure_id=eq.${advId}&status=eq.offered&select=id,terms,reweave_count`)
  ok('re-weave escalates terms above the floor with reweave_count 1', reweaveRow.reweave_count === 1 && reweaveRow.terms.gold > 50, reweaveRow)

  console.log('\n[any clear accept binds the party]')
  const objection = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'I still do not like this...' })
  ok('an objection neither accepts nor declines', objection.status === 200 && !['offer_accepted', 'offer_declined'].includes(objection.body.resolved), objection.body)
  const accept = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We accept the job, elder.' })
  ok('clear accept resolves the offer', accept.status === 200 && accept.body.resolved === 'offer_accepted', accept.body)
  state = await resyncState(gm, advId)
  ok('offer left the banner', state.objectives.offers.length === 0)
  ok('quest in the journal, active', state.objectives.quests.length === 1 && state.objectives.quests[0].status === 'active', state.objectives.quests)
  ok('acceptance activated the first objective', state.objectives.currentId === objective.id, state.objectives)
  const [objRow1] = await serviceRest('GET', `objectives?id=eq.${objective.id}&select=reveal_state`)
  ok('objective row active in the guide', objRow1.reveal_state === 'active')
  ok('accept system line landed', state.dialogue.lines.some((l) => l.text.startsWith('Contract accepted:')))
  const [loopRow] = await serviceRest('GET', `core_loops?adventure_id=eq.${advId}&select=id,type,status,custom_label`)
  ok('core loop pushed and active', loopRow && loopRow.status === 'active' && loopRow.custom_label === 'Escort Maren to the coast', loopRow)
  const acceptedOfferId = state.objectives.quests[0].id
  const restage = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'stage_offer', contract_id: contract.id })
  ok('accepted contract cannot be re-staged', restage.status === 409, restage.body)

  console.log('\n[beats: acceptance opens the first beat, pool reused before generating]')
  const questBeats = await serviceRest('GET', `beats?core_loop_id=eq.${loopRow.id}&select=id,name,status&order=index`)
  ok('first beat opened on acceptance', questBeats.length === 1 && questBeats[0].status === 'active', questBeats)
  const beatEvents = await eventsOf(advId, 'beat_opened')
  ok('beat_opened event logged with variety flags', beatEvents.length >= 1 && beatEvents[0].payload.variety_flags !== undefined, beatEvents.length)
  ok('pool clue reused', (await eventsOf(advId, 'beat_ingredient_reused')).length >= 1)
  ok('generator NOT called when the pool suffices', (await eventsOf(advId, 'ingredient_generated')).length === 0)
  const liveHooks = await serviceRest('GET', `hooks?adventure_id=eq.${advId}&from_ref->>table=eq.live&select=id,kind`)
  ok('live Hook Weaver planted hooks for the objective', liveHooks.length >= 1, liveHooks.length)

  console.log('\n[stuck hint: player asks the DM for their bearings]')
  const hint1 = await act(gm, { action: 'hint', adventure_id: advId, requested: true })
  ok('requested hint lands with a rung', hint1.status === 200 && hint1.body.resolved === 'hint' && hint1.body.rung >= 1, hint1.body)
  ok('hint_given event logged with source', (await eventsOf(advId, 'hint_given')).some((e) => e.payload.source === 'requested'))
  const hint2 = await act(gm, { action: 'hint', adventure_id: advId, requested: true })
  ok('a second ask climbs the ladder', hint2.status === 200 && hint2.body.rung >= hint1.body.rung, hint2.body)
  const tuneHint = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_auto', hint_turns: 5 })
  ok('hint_turns is DM-configurable via set_auto', tuneHint.status === 200, tuneHint.body)

  console.log('\n[encounter machine: canned spec -> entry -> attempts -> resolution -> beat exit]')
  const [specBeat] = await serviceRest('GET', `beats?core_loop_id=eq.${loopRow.id}&status=eq.active&select=id,name,encounter_spec`)
  ok('opened beat carries a canned encounter spec', specBeat.encounter_spec?.kind === 'skill_challenge', specBeat.encounter_spec)
  ok('Encounter Designer filled the challenge params', specBeat.encounter_spec?.params?.needed_successes === 1, specBeat.encounter_spec?.params)
  const enter = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We take on the challenge before us.' })
  ok('offered reply enters the encounter', enter.status === 200 && enter.body.resolved === 'encounter_entered', enter.body)
  state = await resyncState(gm, advId)
  ok('visible encounter frame is live', state.encounter?.kind === 'skill_challenge' && state.encounter?.label === specBeat.encounter_spec.label, state.encounter)
  const entryMapped = await eventsOf(advId, 'entry_mapped')
  ok('entry_mapped logged the offered entry', entryMapped.some((e) => e.payload.entry === 'offered'), entryMapped)
  for (let i = 0; i < 8; i++) {
    state = await resyncState(gm, advId)
    if (!state.encounter) break
    if (state.dialogue.pending) {
      await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: state.dialogue.pending.id })
      continue
    }
    await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I climb the rise for a better line.' })
  }
  state = await resyncState(gm, advId)
  ok('encounter closed after attempts', !state.encounter, state.encounter)
  ok('encounter_attempt events logged', (await eventsOf(advId, 'encounter_attempt')).length >= 1)
  const challengeResolved = (await eventsOf(advId, 'encounter_resolved')).at(-1)
  ok('resolution carries a tier', ['full', 'partial', 'failed'].includes(challengeResolved?.payload?.tier), challengeResolved)
  if (challengeResolved?.payload?.tier !== 'failed') {
    ok('outcome map applied the beat-exit milestone', (await eventsOf(advId, 'milestone_reached')).some((e) => e.payload.source === 'encounter_outcome'))
    ok('resolution exited the beat (next beat opened)', (await eventsOf(advId, 'beat_exit_met')).length >= 1)
    const questBeatsAfter = await serviceRest('GET', `beats?core_loop_id=eq.${loopRow.id}&select=id,status&order=index`)
    ok('quest loop advanced to its second beat', questBeatsAfter.length === 2 && questBeatsAfter.at(-1).status === 'active', questBeatsAfter)
  } else {
    console.log('  note: dice failed the challenge this run - beat stays open (fail-forward)')
  }

  console.log('\n[loop pivot: classifier proposes, full-AI auto-accepts at 0.9]')
  const barricade = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'We barricade the gates and prepare to defend the village!' })
  ok('barricade intent lands', barricade.status === 200, barricade.body)
  const reclassify = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'reclassify' })
  ok('reclassify pivots at high confidence', reclassify.status === 200 && reclassify.body.resolved === 'pivoted' && reclassify.body.new_type === 'siege_defense', reclassify.body)
  const loopsNow = await serviceRest('GET', `core_loops?adventure_id=eq.${advId}&select=id,type,status&order=stack_position`)
  ok('quest loop suspended, siege loop active', loopsNow.length === 2 && loopsNow[0].status === 'suspended' && loopsNow[1].type === 'siege_defense' && loopsNow[1].status === 'active', loopsNow)
  ok('pivot proposal recorded', (await serviceRest('GET', `proposals?adventure_id=eq.${advId}&type=eq.loop_pivot&select=id,status`)).length >= 1)
  state = await resyncState(gm, advId)
  ok('journal shows the quest paused', state.objectives.quests[0].status === 'suspended', state.objectives.quests)
  const siegeLoopId = loopsNow[1].id
  const siegeBeats1 = await serviceRest('GET', `beats?core_loop_id=eq.${siegeLoopId}&select=name,status&order=index`)
  ok('pivoted loop opened its first template beat', siegeBeats1.length === 1 && siegeBeats1[0].name === 'warning', siegeBeats1)

  console.log('\n[beat exit conditions: mark_event -> next beat opens]')
  const exitsBefore = (await eventsOf(advId, 'beat_exit_met')).length
  const exitMark = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'mark_event', tag: 'beat warning resolved' })
  ok('mark_event accepted', exitMark.status === 200, exitMark.body)
  ok('beat exit detected', (await eventsOf(advId, 'beat_exit_met')).length === exitsBefore + 1)
  const siegeBeats2 = await serviceRest('GET', `beats?core_loop_id=eq.${siegeLoopId}&select=name,status&order=index`)
  ok('next template beat opened, previous completed', siegeBeats2.length === 2 && siegeBeats2[0].status === 'completed' && siegeBeats2[1].name === 'preparation' && siegeBeats2[1].status === 'active', siegeBeats2)

  console.log('\n[ledger payout, exactly once]')
  const playerComplete = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'complete_quest', offer_id: acceptedOfferId })
  ok('players cannot complete quests', playerComplete.status === 403)
  const complete = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'complete_quest', offer_id: acceptedOfferId })
  ok('complete_quest pays out', complete.status === 200 && complete.body.paid === true, complete.body)
  state = await resyncState(gm, advId)
  const questGold = state.objectives.quests[0].gold
  ok('party gold credited with accepted terms', state.players.gold === questGold && questGold >= 50, { gold: state.players.gold, questGold })
  ok('journal shows the quest completed', state.objectives.quests[0].status === 'completed')
  const ledger = await eventsOf(advId, 'ledger_credited')
  ok('ledger event logged', ledger.length === 1 && ledger[0].payload.balance === state.players.gold, ledger)
  const completeAgain = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'complete_quest', offer_id: acceptedOfferId })
  ok('second completion 409s (no double pay)', completeAgain.status === 409, completeAgain.body)
  const stateAfter = await resyncState(gm, advId)
  ok('gold unchanged after the 409', stateAfter.players.gold === state.players.gold)

  console.log('\n[objective completion -> ending scoring -> late decisive commitment]')
  const setFlag = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_flag', flag: 'coast_reached', value: true })
  ok('set_flag accepted', setFlag.status === 200, setFlag.body)
  ok('objective completed by predicate evaluation', (await eventsOf(advId, 'objective_completed')).length === 1)
  const [objRow2] = await serviceRest('GET', `objectives?id=eq.${objective.id}&select=reveal_state`)
  ok('objective row completed', objRow2.reveal_state === 'completed')
  state = await resyncState(gm, advId)
  ok('objective completion system line landed', state.dialogue.lines.some((l) => l.text.startsWith('Objective complete:')))
  const [advRow] = await serviceRest('GET', `adventures?id=eq.${advId}&select=ending_scores,committed_ending_id`)
  ok('ending scores computed deterministically', advRow.ending_scores && Object.values(advRow.ending_scores).some((v) => v === 3), advRow.ending_scores)
  ok('decisive late lead auto-committed (full-AI, clean consistency)', Boolean(advRow.committed_ending_id), advRow)
  const endingRows = await serviceRest('GET', `endings?adventure_id=eq.${advId}&select=title,status&order=index`)
  ok('committed/discarded statuses written', endingRows[0].status === 'committed' && endingRows[1].status === 'discarded', endingRows)
  ok('ending_committed event logged', (await eventsOf(advId, 'ending_committed')).length === 1)

  console.log('\n[idle nudge validates idleness server-side]')
  const nudge = await act(gm, { action: 'idle_nudge', adventure_id: advId })
  ok('nudge 409s while the table is active (not idle yet)', nudge.status === 409, nudge.body)

  console.log('\n[journal survives a session restart; antagonist turns at session end]')
  ok('end session', (await act(gm, { action: 'end_session', adventure_id: advId })).status === 200)
  ok('antagonist advanced off-screen at session end', (await eventsOf(advId, 'antagonist_advanced')).length >= 1)
  const rumors = await serviceRest('GET', `ingredients?adventure_id=eq.${advId}&type=eq.rumor&select=id`)
  ok('surfacing became a rumor ingredient (full-AI auto)', rumors.length >= 1, rumors.length)
  const restarted = await act(gm, { action: 'start_session', adventure_id: advId })
  ok('session 2 starts', restarted.status === 200, restarted.body)
  state = await resyncState(gm, advId)
  ok('entry offer NOT re-staged after acceptance', state.objectives.offers.length === 0, state.objectives.offers)
  ok('journal rebuilt from tables on restart', state.objectives.quests.length === 1 && state.objectives.quests[0].status === 'completed', state.objectives.quests)

  console.log('\n[suspicion tally -> BBEG commitment (2 sessions, tally 5)]')
  for (let i = 0; i < 5; i++) {
    const sus = await act(p2, {
      action: 'player_intent', adventure_id: advId, kind: 'say',
      text: `I still don't trust Elder Maren - she's hiding something about the ferry (${i}).`,
    })
    ok(`suspicious utterance ${i + 1} lands`, sus.status === 200, sus.body)
  }
  ok('suspicion events tagged', (await eventsOf(advId, 'suspicion_noted')).length >= 5)
  const [metaRow] = await serviceRest('GET', `meta_loop?adventure_id=eq.${advId}&select=committed_bbeg_npc_id,suspicion_tally`)
  ok('BBEG committed at threshold with 2+ sessions (full-AI)', metaRow && metaRow.committed_bbeg_npc_id === maren.id, metaRow)
  ok('bbeg_committed event logged', (await eventsOf(advId, 'bbeg_committed')).length === 1)

  console.log('\n[player-theory canonization (F08 SS5)]')
  ok('stage Maren for a scene', (await act(gm, { action: 'start_social', adventure_id: advId, npc_ids: [maren.id] })).status === 200)
  const theory1 = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'say',
    text: 'My theory: the ferryman sank his own boat for the salvage rights.',
  })
  ok('consistent theory canonized on a clean pass', theory1.status === 200 && (await eventsOf(advId, 'theory_canonized')).length === 1, theory1.body)
  const canonRows = await serviceRest('GET', `ingredients?adventure_id=eq.${advId}&canon_source=eq.player_theory&select=id,discovered`)
  ok('canonized ingredient row created (discovered)', canonRows.length === 1 && canonRows[0].discovered === true, canonRows)
  const markDead = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_npc_state', npc_id: tobbin.id, state: 'dead' })
  ok('mark Tobbin dead', markDead.status === 200, markDead.body)
  const theory2 = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'say',
    text: 'My theory: Old Tobbin cursed the ferry himself last night.',
  })
  ok('contradicting theory blocked with the conflict shown', theory2.status === 200 && (await eventsOf(advId, 'canonization_blocked')).length === 1, theory2.body)
  ok('no second canonized ingredient', (await serviceRest('GET', `ingredients?adventure_id=eq.${advId}&canon_source=eq.player_theory&select=id`)).length === 1)
  ok('end scene', (await act(gm, { action: 'end_encounter', adventure_id: advId })).status === 200)

  console.log('\n[social encounter: seeded exits -> judged exit -> beat advance (Slice 4)]')
  const siegeBeatsPre = await serviceRest('GET', `beats?core_loop_id=eq.${siegeLoopId}&select=id,name,status&order=index`)
  // The outcome map must target the CURRENT active beat's exit event (objective completion
  // force-replans beats, so the open beat name moves as the suite progresses).
  const activeSiegeBeat = siegeBeatsPre.find((b) => b.status === 'active')
  const siegeExitTag = `beat ${activeSiegeBeat.name} resolved`
  const openSocial = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'open_encounter',
    encounter_kind: 'social', label: 'Steady the elder', stakes: 'Her nerve decides the defense',
    goal: 'Reassure Maren that the walls will hold', npc_ids: [maren.id],
    exits: [
      { outcome: 'reassured', description: 'Maren steadies herself', tier: 'success' },
      { outcome: 'despairing', description: 'Maren gives up on the defense', tier: 'failure' },
    ],
    on_success: [siegeExitTag], on_partial: [], on_failure: [],
  })
  ok('social encounter seeds via dm_command', openSocial.status === 200, openSocial.body)
  state = await resyncState(gm, advId)
  ok('social frame live, NPC staged in roleplay',
    state.encounter?.kind === 'social' && state.scene.mode === 'roleplay' && state.dialogue.speakers.length === 1,
    { encounter: state.encounter, mode: state.scene.mode })
  const socialSay = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'You look reassured at last, elder - the walls will hold.' })
  ok('say inside the encounter runs the NPC pipeline', socialSay.status === 200 && socialSay.body.resolved === 'conversation', socialSay.body)
  state = await resyncState(gm, advId)
  ok('judged exit resolved the encounter (frame closed, scene ended)',
    !state.encounter && state.dialogue.speakers.length === 0, { encounter: state.encounter, speakers: state.dialogue.speakers })
  const socialResolved = (await eventsOf(advId, 'encounter_resolved')).filter((e) => e.payload.kind === 'social')
  ok('social resolution carries the full tier', socialResolved.length === 1 && socialResolved[0].payload.tier === 'full', socialResolved)
  const exitEvents = await eventsOf(advId, 'encounter_exit')
  ok('exit event logged with the authored outcome', exitEvents.length === 1 && exitEvents[0].payload.outcome === 'reassured' && exitEvents[0].payload.forced === false, exitEvents)
  ok('exchange counted toward contributions', (await eventsOf(advId, 'encounter_attempt')).some((e) => e.payload.kind === 'social'))
  const siegeBeatsPost = await serviceRest('GET', `beats?core_loop_id=eq.${siegeLoopId}&select=id,name,status&order=index`)
  ok('social success exited the siege beat (next beat opened)', siegeBeatsPost.length === siegeBeatsPre.length + 1, siegeBeatsPost)

  console.log('\n[social encounter: disposition floor forces a hostile exit]')
  await serviceRest('PATCH', `npc_dispositions?npc_id=eq.${maren.id}&character_id=eq.${p2Char.id}`, { value: -8 })
  const openHostile = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'open_encounter',
    encounter_kind: 'social', label: 'Calm the elder again', stakes: 'The defense frays',
    goal: 'Keep Maren from despair', npc_ids: [maren.id],
    exits: [
      { outcome: 'steadied', description: 'Maren holds on', tier: 'success' },
      { outcome: 'despairing', description: 'Maren gives up', tier: 'failure' },
    ],
    on_success: [], on_partial: [], on_failure: [],
  })
  ok('second social encounter seeds', openHostile.status === 200, openHostile.body)
  const hostileSay = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'The night is cold, elder.' })
  ok('hostile-floor say still processes', hostileSay.status === 200, hostileSay.body)
  state = await resyncState(gm, advId)
  ok('forced exit closed the encounter', !state.encounter, state.encounter)
  const forcedExit = (await eventsOf(advId, 'encounter_exit')).at(-1)
  ok('exit was forced by the disposition floor (failure tier)',
    forcedExit?.payload.forced === true && forcedExit?.payload.tier === 'failed', forcedExit)
  const siegeBeatsFinal = await serviceRest('GET', `beats?core_loop_id=eq.${siegeLoopId}&select=id&order=index`)
  ok('failed social left the beat in place', siegeBeatsFinal.length === siegeBeatsPost.length, siegeBeatsFinal.length)

  console.log('\n[random encounter: danger spawn interrupts and restores (Slice 6)]')
  const [dangerLoc] = await serviceRest('POST', 'locations', {
    adventure_id: advId, chapter_id: chapter.id, name: 'The Black Fen',
    description: 'A drowned road through the marsh.', danger: 5,
  })
  ok('set scene to the dangerous location', (await act(gm, { action: 'set_scene', adventure_id: advId, location_id: dangerLoc.id })).status === 200)
  const openOriginal = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'open_encounter',
    encounter_kind: 'skill_challenge', label: 'Ford the drowned road', stakes: 'The cart sinks',
    needed_successes: 1, max_failures: 3, suggested_skills: ['athletics'],
    on_success: [], on_partial: [], on_failure: [],
  })
  ok('original challenge opens', openOriginal.status === 200, openOriginal.body)
  const talk = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'What do I see around the ford?' })
  ok('mid-encounter say gets a DM answer, not silence', talk.status === 200 && talk.body.resolved === 'encounter_talk', talk.body)
  state = await resyncState(gm, advId)
  ok('encounter-talk narration landed', state.dialogue.lines.at(-1)?.speaker === null && state.dialogue.lines.at(-1)?.text.includes('[demo narration]'), state.dialogue.lines.at(-1))
  const dayRoll = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'advance_day' })
  ok('advance_day accepted', dayRoll.status === 200, dayRoll.body)
  const spawnRolls = await eventsOf(advId, 'random_encounter_roll')
  ok('spawn roll logged and spawned (danger 5, demo-deterministic)',
    spawnRolls.length >= 1 && spawnRolls.at(-1).payload.spawned === true && spawnRolls.at(-1).payload.score >= 5,
    spawnRolls.at(-1))
  state = await resyncState(gm, advId)
  ok('spawned encounter interrupts (original stacked underneath)',
    state.encounter?.label !== 'Ford the drowned road' && state.encounter?.interrupted?.label === 'Ford the drowned road',
    state.encounter)
  for (let i = 0; i < 8; i++) {
    state = await resyncState(gm, advId)
    if (!state.encounter || state.encounter.label === 'Ford the drowned road') break
    if (state.dialogue.pending) {
      await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: state.dialogue.pending.id })
      continue
    }
    await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I climb clear of the hazard and pull the others through.' })
  }
  state = await resyncState(gm, advId)
  ok('interrupted encounter restored after the spawn resolved',
    state.encounter?.label === 'Ford the drowned road' && !state.encounter?.interrupted, state.encounter)
  ok('encounter_restored logged', (await eventsOf(advId, 'encounter_restored')).length >= 1)
  for (let i = 0; i < 8; i++) {
    state = await resyncState(gm, advId)
    if (!state.encounter) break
    if (state.dialogue.pending) {
      await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: state.dialogue.pending.id })
      continue
    }
    await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I climb the last stretch of the drowned road.' })
  }
  ok('original challenge closes cleanly too', !(await resyncState(gm, advId)).encounter)

  console.log('\n[RLS + spend]')
  const p2Offers = await restAs(p2, 'GET', `quest_offers?adventure_id=eq.${advId}&select=id`)
  ok('players read no quest_offers rows', Array.isArray(p2Offers.body) && p2Offers.body.length === 0, p2Offers.body)
  const p2Loops = await restAs(p2, 'GET', `core_loops?adventure_id=eq.${advId}&select=id`)
  ok('players read no core_loops rows', Array.isArray(p2Loops.body) && p2Loops.body.length === 0, p2Loops.body)
  const p2Contracts = await restAs(p2, 'GET', `quest_contracts?adventure_id=eq.${advId}&select=id`)
  ok('players read no quest_contracts rows', Array.isArray(p2Contracts.body) && p2Contracts.body.length === 0, p2Contracts.body)
  const p2Beats = await restAs(p2, 'GET', `beats?select=id`)
  ok('players read no beats rows', Array.isArray(p2Beats.body) && p2Beats.body.length === 0, p2Beats.body)
  const p2Meta = await restAs(p2, 'GET', `meta_loop?adventure_id=eq.${advId}&select=adventure_id`)
  ok('players read no meta_loop rows', Array.isArray(p2Meta.body) && p2Meta.body.length === 0, p2Meta.body)
  ok('zero LLM spend across the suite', (await usageCount(advId)) === 0)

  console.log(`\nall ${pass} checks passed`)

  await serviceRest('DELETE', `adventures?id=eq.${advId}`)
  await serviceRest('DELETE', `characters?id=eq.${gmChar.id}`)
  await serviceRest('DELETE', `characters?id=eq.${p2Char.id}`)
  for (const id of Object.values(userIds)) await deleteUser(id)
  console.log('cleanup complete')
}

main().catch(async (err) => {
  console.error('\nFAILED:', err.message ?? err)
  for (const id of Object.values(userIds)) await deleteUser(id).catch(() => {})
  process.exitCode = 1
})
