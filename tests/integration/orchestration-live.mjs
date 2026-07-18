// Phase 5 live integration suite (DEVELOPMENT-PLAN PHASE 5 AI-tests) against the real project:
//   - fast-path intents (explicit roll, chat) never touch an LLM (usage_log stays empty -
//     the whole suite runs on a demo adventure with canned agents: total spend $0)
//   - say pipeline: plain conversation replies, influence/insight check prompts with
//     table-derived DCs, opening emit -> cross-consume with self-consume blocked
//   - adversarial reveal gating: a "tell me the secret" prompt makes the canned NPC request
//     every knowledge id; only entitled ingredients get discovered
//   - group checks (both-roll resolve), assist slots (self-claim denied, second-PC claim),
//     prompt expiry via resolve_pending (server-validated deadline)
//   - consistency: dead-NPC narration deterministically blocked -> mechanical fallback
//   - proposal lifecycle: auto_applied audit rows, pending decide round-trip, expired
//     proposals cannot be applied; players cannot read proposals
//   - state_version race: concurrent chat intents both commit (retry, no lost update)
//
// Creates throwaway users/rows and deletes them at the end; safe to re-run.
// Usage: node tests/integration/orchestration-live.mjs
// Requires: VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY (frontend/.env.local),
//           SUPABASE_SERVICE_ROLE_KEY (backend/.env), the `session` function deployed,
//           migration 20260718130000 applied.
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const stamp = Date.now()
const emails = { gm: `p5-gm-${stamp}@example.com`, p2: `p5-p2-${stamp}@example.com` }
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

async function main() {
  for (const [key, email] of Object.entries(emails)) userIds[key] = await createConfirmedUser(email)
  const gm = await signIn(emails.gm)
  const p2 = await signIn(emails.p2)
  await serviceRest('POST', 'user_settings?on_conflict=user_id', {
    user_id: userIds.gm, provider: 'openrouter',
  }).catch(() => {})
  console.log('setup: users created')

  // Full-AI demo adventure: canned agents, proposals auto-applied, zero spend.
  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.gm, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'Phase 5 orchestration test', status: 'guide_ready', demo: true,
    title: 'P5 Orchestration Test', meta_loop: { premise: 'A quiet village hides a secret.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'Chapter', arc_summary: 'arc', status: 'active',
  })
  await serviceRest('POST', 'objectives', {
    adventure_id: advId, chapter_id: chapter.id, index: 0, title: 'Find the truth',
    hidden_description: 'The miller did it.', reveal_state: 'active',
    completion_predicates: { all: [{ event: 'never' }] },
  })
  const [maren] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Elder Maren', role: 'npc',
    personality: { summary: 'wary, protective' }, description: 'The village elder.', faction: 'village',
  })
  const [volgarth] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Volgarth', role: 'npc',
    personality: { summary: 'dead lich' }, description: 'A defeated lich.', faction: 'enemy',
  })

  const [gmChar] = await serviceRest('POST', 'characters', {
    user_id: userIds.gm, name: 'Ash', level: 1, is_complete: true,
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 10, cha: 14 },
    skill_proficiencies: ['athletics', 'persuasion', 'stealth'], hp_max: 12, hp_current: 12,
  })
  const [p2Char] = await serviceRest('POST', 'characters', {
    user_id: userIds.p2, name: 'Bryn', level: 1, is_complete: true,
    abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 20, cha: 10 },
    skill_proficiencies: ['insight', 'athletics', 'stealth'], hp_max: 10, hp_current: 10,
  })

  // Knowledge on Maren: open / condition-locked / affinity-bound-to-Bryn.
  const mkIngredient = (extra) => ({
    adventure_id: advId, chapter_id: chapter.id, type: 'secret',
    content: { text: 'something' }, reveals: 'a clue', ...extra,
  })
  const [ingOpen] = await serviceRest('POST', 'ingredients', mkIngredient({
    placement: { npc_id: maren.id },
  }))
  const [ingGated] = await serviceRest('POST', 'ingredients', mkIngredient({
    placement: { npc_id: maren.id, condition: 'successful DC 16 persuasion' },
  }))
  const [ingBound] = await serviceRest('POST', 'ingredients', mkIngredient({
    placement: { npc_id: maren.id }, reveals_to: { character_id: p2Char.id },
  }))

  console.log('\n[lobby -> session]')
  ok('activate', (await act(gm, { action: 'activate', adventure_id: advId })).status === 200)
  const [{ invite_code: invite }] = await serviceRest('GET', `adventures?id=eq.${advId}&select=invite_code`)
  ok('p2 joins', (await act(p2, { action: 'join', invite_code: invite })).status === 200)
  ok('gm picks', (await act(gm, { action: 'pick_character', adventure_id: advId, character_id: gmChar.id })).status === 200)
  ok('p2 picks', (await act(p2, { action: 'pick_character', adventure_id: advId, character_id: p2Char.id })).status === 200)
  ok('gm ready', (await act(gm, { action: 'ready', adventure_id: advId, ready: true })).status === 200)
  ok('p2 ready', (await act(p2, { action: 'ready', adventure_id: advId, ready: true })).status === 200)
  const started = await act(gm, { action: 'start_session', adventure_id: advId })
  ok('creator starts session (full-AI)', started.status === 200, started.body)

  console.log('\n[fast path + chat: zero LLM]')
  const usage0 = await usageCount(advId)
  const roll = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'roll', skill: 'athletics' })
  ok('explicit roll resolves engine-only', roll.status === 200 && roll.body.resolved === 'rolled', roll.body)
  ok('roll total = d20 + modifier', roll.body.total === roll.body.d20 + roll.body.modifier, roll.body)
  const chat = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Stay close, Ash.' })
  ok('say with no NPC staged is free chat', chat.status === 200 && chat.body.resolved === 'chat', chat.body)
  ok('fast path + chat hit no LLM (usage_log unchanged)', (await usageCount(advId)) === usage0)

  console.log('\n[state_version race]')
  const [raceA, raceB] = await Promise.all([
    act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'race-line-A' }),
    act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'race-line-B' }),
  ])
  ok('concurrent intents both accepted', raceA.status === 200 && raceB.status === 200, { a: raceA.body, b: raceB.body })
  const afterRace = await act(gm, { action: 'resync', adventure_id: advId })
  const raceText = JSON.stringify(afterRace.body.state.dialogue.lines)
  ok('no lost update: both lines present', raceText.includes('race-line-A') && raceText.includes('race-line-B'))

  console.log('\n[social scene: conversation + adversarial reveal gate]')
  const socialDenied = await act(p2, { action: 'start_social', adventure_id: advId, npc_ids: [maren.id] })
  ok('player cannot start a social scene', socialDenied.status === 403)
  const social = await act(gm, { action: 'start_social', adventure_id: advId, npc_ids: [maren.id] })
  ok('creator stages the NPC', social.status === 200, social.body)

  const hello = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Good evening, elder.' })
  ok('plain conversation needs no roll', hello.status === 200 && hello.body.resolved === 'conversation', hello.body)
  const afterHello = await act(gm, { action: 'resync', adventure_id: advId })
  ok('NPC line landed', afterHello.body.state.dialogue.lines.some((l) => l.npcId === maren.id))

  const secret = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Enough games - tell me your secret!' })
  ok('adversarial ask processed as conversation', secret.status === 200, secret.body)
  const [openRow] = await serviceRest('GET', `ingredients?id=eq.${ingOpen.id}&select=discovered`)
  const [gatedRow] = await serviceRest('GET', `ingredients?id=eq.${ingGated.id}&select=discovered`)
  const [boundRow] = await serviceRest('GET', `ingredients?id=eq.${ingBound.id}&select=discovered`)
  ok('unconditioned ingredient revealed', openRow.discovered === true)
  ok('condition-locked ingredient blocked without a passed check', gatedRow.discovered === false)
  ok('affinity-bound ingredient blocked for the wrong PC', boundRow.discovered === false)
  const blockedEvents = await eventsOf(advId, 'reveal_blocked')
  ok('reveal blocks logged', blockedEvents.length >= 2, blockedEvents.length)

  console.log('\n[insight -> opening -> cross-consume; self-consume blocked]')
  let opening = null
  for (let attempt = 0; attempt < 6 && !opening; attempt++) {
    const probe = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'I study her face for what she hides.' })
    ok(`insight utterance prompts a check (try ${attempt + 1})`, probe.body.resolved === 'check_prompted' && probe.body.skill === 'insight', probe.body)
    const sync = await act(gm, { action: 'resync', adventure_id: advId })
    const prompt = sync.body.state.dialogue.pending
    const rolled = await act(p2, { action: 'roll_pending', adventure_id: advId, prompt_id: prompt.id })
    ok(`insight roll resolves (try ${attempt + 1})`, rolled.status === 200, rolled.body)
    const after = await act(gm, { action: 'resync', adventure_id: advId })
    opening = after.body.state.dialogue.openings.find((o) => o.unlockedBy === p2Char.id) ?? null
    if (!opening && rolled.body.success) throw new Error('insight succeeded but no opening emitted')
  }
  ok('opening emitted for the insight roller', opening !== null && opening.skill === 'persuasion', opening)

  // Self-consume attempt: the unlocker's own persuasion must NOT eat the opening.
  const selfTry = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Please, you can trust us.' })
  ok('unlocker influence prompts a check', selfTry.body.resolved === 'check_prompted', selfTry.body)
  let sync = await act(gm, { action: 'resync', adventure_id: advId })
  ok('self-consume blocked: opening still there', sync.body.state.dialogue.openings.some((o) => o.id === opening.id))
  const selfDc = sync.body.state.dm.conversation.pendingContext.dc
  await act(p2, { action: 'roll_pending', adventure_id: advId, prompt_id: sync.body.state.dialogue.pending.id })

  const crossTry = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Please, elder - let us help you.' })
  ok('other PC influence prompts a check', crossTry.body.resolved === 'check_prompted', crossTry.body)
  sync = await act(gm, { action: 'resync', adventure_id: advId })
  ok('cross-consume: opening gone', !sync.body.state.dialogue.openings.some((o) => o.id === opening.id))
  const crossDc = sync.body.state.dm.conversation.pendingContext.dc
  ok('opening lowered the DC', crossDc === selfDc + opening.dcMod, { selfDc, crossDc, mod: opening.dcMod })
  const consumed = await eventsOf(advId, 'opening_consumed')
  ok('cooperation event logged', consumed.length === 1 && consumed[0].payload.by === gmChar.id)
  await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: sync.body.state.dialogue.pending.id })

  console.log('\n[generic NPC + end encounter -> interaction memory]')
  const generic = await act(gm, { action: 'generic_npc', adventure_id: advId, role_hint: 'shopkeeper' })
  ok('generic NPC created + staged', generic.status === 200 && generic.body.npc_id, generic.body)
  const [genericRow] = await serviceRest('GET', `npcs?id=eq.${generic.body.npc_id}&select=generated`)
  ok('generic flag set', genericRow.generated === true)
  const ended = await act(gm, { action: 'end_encounter', adventure_id: advId })
  ok('encounter ends', ended.status === 200, ended.body)
  const interactions = await serviceRest('GET', `npc_interactions?adventure_id=eq.${advId}&select=npc_id`)
  ok('interaction memory written per staged NPC', interactions.length === 2, interactions.length)
  sync = await act(gm, { action: 'resync', adventure_id: advId })
  ok('scene back to narration, openings cleared',
    sync.body.state.scene.mode === 'narration' && sync.body.state.dialogue.openings.length === 0)

  console.log('\n[group check]')
  const groupIntent = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'We all sneak past together.' })
  ok('group check prompted', groupIntent.body.resolved === 'check_prompted' && groupIntent.body.prompt.kind === 'group', groupIntent.body)
  const groupId = groupIntent.body.prompt.id
  const gmGroupRoll = await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: groupId })
  ok('first roller waits on the rest', gmGroupRoll.body.waiting === true, gmGroupRoll.body)
  const dupRoll = await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: groupId })
  ok('double-roll rejected', dupRoll.status === 409)
  const p2GroupRoll = await act(p2, { action: 'roll_pending', adventure_id: advId, prompt_id: groupId })
  ok('last roller completes the group', p2GroupRoll.status === 200 && p2GroupRoll.body.waiting === false, p2GroupRoll.body)
  const groupResolved = await eventsOf(advId, 'group_check_resolved')
  ok('half-pass rule applied', groupResolved.length === 1 && groupResolved[0].payload.needed === 1, groupResolved[0]?.payload)

  console.log('\n[assist slot]')
  const assistIntent = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I brace and hold the gate shut!' })
  ok('assist slot prompted', assistIntent.body.resolved === 'check_prompted' && assistIntent.body.prompt.kind === 'assist', assistIntent.body)
  const assistId = assistIntent.body.prompt.id
  const selfClaim = await act(gm, { action: 'claim_assist', adventure_id: advId, prompt_id: assistId })
  ok('cannot assist your own attempt', selfClaim.status === 403)
  const claim = await act(p2, { action: 'claim_assist', adventure_id: advId, prompt_id: assistId })
  ok('second PC claims the assist', claim.status === 200, claim.body)
  if (claim.body.resolved === 'primary_prompted') {
    sync = await act(gm, { action: 'resync', adventure_id: advId })
    const primary = sync.body.state.dialogue.pending
    ok('primary check prompted for the actor', primary?.kind === 'check' && primary.actorCharacterId === gmChar.id)
    const primaryRoll = await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: primary.id })
    ok('primary roll resolves', primaryRoll.status === 200, primaryRoll.body)
  } else {
    ok('enable-gated assist failed forward', claim.body.resolved === 'fail_forward', claim.body)
  }
  const claimEvents = await eventsOf(advId, 'assist_claimed')
  ok('assist cooperation event logged', claimEvents.length === 1 && claimEvents[0].payload.by === p2Char.id)

  console.log('\n[prompt expiry via resolve_pending]')
  const soloIntent = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I climb the old wall.' })
  ok('solo check prompted', soloIntent.body.resolved === 'check_prompted' && soloIntent.body.prompt.kind === 'check', soloIntent.body)
  const soloId = soloIntent.body.prompt.id
  const early = await act(p2, { action: 'resolve_pending', adventure_id: advId, prompt_id: soloId })
  ok('sweep before the deadline rejected', early.status === 409, early.body)
  await sleep(21000)
  const swept = await act(p2, { action: 'resolve_pending', adventure_id: advId, prompt_id: soloId })
  ok('expired prompt auto-rolls', swept.status === 200 && swept.body.resolved === 'auto_rolled', swept.body)

  console.log('\n[consistency: dead NPC blocked]')
  const factSet = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command',
    command: 'set_npc_state', npc_id: volgarth.id, state: 'dead',
  })
  ok('dm_command records the fact', factSet.status === 200, factSet.body)
  const factDenied = await act(p2, {
    action: 'player_intent', adventure_id: advId, kind: 'dm_command',
    command: 'set_npc_state', npc_id: volgarth.id, state: 'alive',
  })
  ok('players cannot dm_command', factDenied.status === 403)
  const ghost = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I call out to Volgarth across the square.' })
  ok('action referencing the dead NPC still resolves', ghost.status === 200, ghost.body)
  sync = await act(gm, { action: 'resync', adventure_id: advId })
  const lastLine = sync.body.state.dialogue.lines.at(-1)
  ok('narration fell back to the mechanical description', lastLine.text === 'The attempt is resolved; the outcome stands.', lastLine)
  const blockedNarration = await eventsOf(advId, 'consistency_blocked')
  ok('consistency block logged', blockedNarration.length >= 1)

  console.log('\n[narrate_next options flow]')
  const narrateDenied = await act(p2, { action: 'narrate_next', adventure_id: advId })
  ok('player cannot narrate_next', narrateDenied.status === 403)
  const narrated = await act(gm, { action: 'narrate_next', adventure_id: advId, prompt: 'Something stirs.' })
  ok('narrate_next returns 3-4 options + published text',
    narrated.status === 200 && narrated.body.options.length >= 3 && typeof narrated.body.text === 'string', narrated.body)

  console.log('\n[slice 2: assist review gate]')
  // Second adventure in assist mode (demo -> canned gists, zero spend). Gate is on by default.
  const [assistAdv] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.gm, mode: 'assist', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'Slice 2 gate test', status: 'guide_ready', demo: true,
    title: 'S2 Gate Test', meta_loop: {},
  })
  const advB = assistAdv.id
  const [chapterB] = await serviceRest('POST', 'chapters', {
    adventure_id: advB, index: 0, title: 'Chapter', arc_summary: 'arc', status: 'active',
  })
  const [tila] = await serviceRest('POST', 'npcs', {
    adventure_id: advB, chapter_id: chapterB.id, name: 'Warden Tila', role: 'npc',
    personality: { summary: 'stern' }, description: 'The gate warden.', faction: 'village',
  })
  const [p2CharB] = await serviceRest('POST', 'characters', {
    user_id: userIds.p2, name: 'Bryn II', level: 1, is_complete: true,
    abilities: { str: 14, dex: 12, con: 12, int: 10, wis: 16, cha: 10 },
    skill_proficiencies: ['insight', 'stealth'], hp_max: 10, hp_current: 10,
  })
  ok('assist adventure activates', (await act(gm, { action: 'activate', adventure_id: advB })).status === 200)
  const [{ invite_code: inviteB }] = await serviceRest('GET', `adventures?id=eq.${advB}&select=invite_code`)
  ok('p2 joins assist adventure', (await act(p2, { action: 'join', invite_code: inviteB })).status === 200)
  ok('p2 picks fresh character', (await act(p2, { action: 'pick_character', adventure_id: advB, character_id: p2CharB.id })).status === 200)
  ok('p2 ready', (await act(p2, { action: 'ready', adventure_id: advB, ready: true })).status === 200)
  const startedB = await act(gm, { action: 'start_session', adventure_id: advB })
  ok('DM starts the assist session', startedB.status === 200, startedB.body)
  ok('DM stages the NPC', (await act(gm, { action: 'start_social', adventure_id: advB, npc_ids: [tila.id] })).status === 200)

  const gatedSay = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'Good evening, warden.' })
  ok('say stages a review instead of replying', gatedSay.status === 200 && gatedSay.body.resolved === 'review_staged', gatedSay.body)
  let syncB = await act(gm, { action: 'resync', adventure_id: advB })
  let reviewB = syncB.body.state.dm.pendingReview
  ok('review holds 3 candidate gists, typing cleared',
    reviewB && reviewB.candidates.length === 3 && syncB.body.state.dialogue.typing === false, reviewB)
  ok('no NPC line reached the table yet', !syncB.body.state.dialogue.lines.some((l) => l.npcId === tila.id))
  const p2SyncB = await act(p2, { action: 'resync', adventure_id: advB })
  ok('players never see the pending review', !JSON.stringify(p2SyncB.body).includes('pendingReview'))

  const lockedSay = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'Hello?' })
  ok('table locked while the DM decides', lockedSay.status === 409, lockedSay.body)
  const playerDecide = await act(p2, { action: 'review_decide', adventure_id: advB, review_id: reviewB.id, choice: 'pick', candidate_id: reviewB.candidates[0].id })
  ok('players cannot decide reviews', playerDecide.status === 403)
  const staleDecide = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: 'bogus-id', choice: 'dismiss' })
  ok('stale review id rejected', staleDecide.status === 409, staleDecide.body)

  const picked = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: reviewB.id, choice: 'pick', candidate_id: reviewB.candidates[0].id })
  ok('DM picks a gist -> reply sent', picked.status === 200 && picked.body.resolved === 'sent', picked.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const pickedLine = syncB.body.state.dialogue.lines.at(-1)
  ok('reply follows the picked gist', pickedLine.npcId === tila.id && pickedLine.text === `[directed] ${reviewB.candidates[0].gist}`, pickedLine)
  ok('review cleared after send', !syncB.body.state.dm.pendingReview)

  const say2 = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'And another thing.' })
  ok('next say stages a fresh review', say2.body.resolved === 'review_staged', say2.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const beforeRegen = syncB.body.state.dm.pendingReview
  const regen = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: beforeRegen.id, choice: 'regenerate' })
  ok('regenerate replaces the set', regen.status === 200 && regen.body.resolved === 'regenerated', regen.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const afterRegen = syncB.body.state.dm.pendingReview
  ok('regenerated review is new and still locks the table', afterRegen && afterRegen.id !== beforeRegen.id, { before: beforeRegen.id, after: afterRegen?.id })
  const steered = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: afterRegen.id, choice: 'steer', gist: 'She spits at your feet' })
  ok('DM steers with their own gist', steered.status === 200 && steered.body.resolved === 'sent', steered.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  ok('reply follows the DM gist', syncB.body.state.dialogue.lines.at(-1).text === '[directed] She spits at your feet')

  const say3 = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'Sorry to bother you.' })
  ok('third say stages a review', say3.body.resolved === 'review_staged', say3.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const dismissed = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: syncB.body.state.dm.pendingReview.id, choice: 'dismiss' })
  ok('dismiss sends nothing and unlocks', dismissed.status === 200 && dismissed.body.resolved === 'dismissed', dismissed.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  ok('no reply after dismiss', syncB.body.state.dialogue.lines.at(-1).text === 'Sorry to bother you.')

  console.log('\n[slice 3: narration gate]')
  const gatedNarrate = await act(gm, { action: 'narrate_next', adventure_id: advB, prompt: 'The wind rises.' })
  ok('narrate_next stages a review instead of publishing', gatedNarrate.body.resolved === 'review_staged', gatedNarrate.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const narrReview = syncB.body.state.dm.pendingReview
  ok('narration review holds candidates + label', narrReview?.kind === 'narration' && narrReview.candidates.length === 3, narrReview)
  const narrateBlocked = await act(gm, { action: 'narrate_next', adventure_id: advB })
  ok('narrate_next blocked while a review is pending', narrateBlocked.status === 409, narrateBlocked.body)
  const narrSteer = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: narrReview.id, choice: 'steer', gist: 'Thunder splits the sky' })
  ok('DM steers the narration', narrSteer.status === 200 && narrSteer.body.resolved === 'sent', narrSteer.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const narrLine = syncB.body.state.dialogue.lines.at(-1)
  ok('published narration follows the DM direction',
    narrLine.speaker === null && narrLine.text.includes('Thunder splits the sky'), narrLine)

  const doIntent = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'do', text: 'I climb the watchtower.' })
  ok('do intent prompts a check as usual (mechanical, ungated)', doIntent.body.resolved === 'check_prompted', doIntent.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const doRoll = await act(p2, { action: 'roll_pending', adventure_id: advB, prompt_id: syncB.body.state.dialogue.pending.id })
  ok('outcome roll resolves', doRoll.status === 200, doRoll.body)
  // Both gates are off here, so the flow is two-stage: check ruling first, then the narration review.
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const doRuling = syncB.body.state.dm.pendingReview
  ok('check ruling staged first (slice 4 gate)', doRuling?.kind === 'check_ruling', doRuling)
  const doAccept = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: doRuling.id, choice: 'accept' })
  ok('DM accepts the roll outcome', doAccept.status === 200 && doAccept.body.resolved === 'accepted', doAccept.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const doReview = syncB.body.state.dm.pendingReview
  ok('outcome narration staged for review', doReview?.kind === 'narration' && doReview.label === 'Action outcome', doReview)
  const doPick = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: doReview.id, choice: 'pick', candidate_id: doReview.candidates[1].id })
  ok('DM picks an outcome direction', doPick.status === 200 && doPick.body.resolved === 'sent', doPick.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  ok('outcome narration published with the picked direction',
    syncB.body.state.dialogue.lines.at(-1).text.includes(doReview.candidates[1].gist), syncB.body.state.dialogue.lines.at(-1))

  const autoOn = await act(gm, {
    action: 'player_intent', adventure_id: advB, kind: 'dm_command', command: 'set_auto', auto_dialogue: true,
  })
  ok('DM switches auto-dialogue on', autoOn.status === 200 && autoOn.body.settings.autoDialogue === true, autoOn.body)
  const autoSay = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'One last question.' })
  ok('auto-dialogue on -> reply flows without review', autoSay.body.resolved === 'conversation', autoSay.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  ok('NPC line landed directly', syncB.body.state.dialogue.lines.at(-1).npcId === tila.id)

  console.log('\n[slice 4: check ruling gate]')
  // auto_dialogue is ON here; auto_checks is still off, so rolls pause for the DM ruling.
  const socialAsk = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'Please, you can trust us.' })
  ok('influence utterance prompts a check', socialAsk.body.resolved === 'check_prompted', socialAsk.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const socialRoll = await act(p2, { action: 'roll_pending', adventure_id: advB, prompt_id: syncB.body.state.dialogue.pending.id })
  ok('social roll resolves into a ruling', socialRoll.status === 200, socialRoll.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const socialRuling = syncB.body.state.dm.pendingReview
  ok('check ruling staged (prompt cleared, review pending)',
    socialRuling?.kind === 'check_ruling' && syncB.body.state.dialogue.pending === undefined, socialRuling)
  const rulingLock = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'say', text: 'Hello?' })
  ok('table locked during the ruling', rulingLock.status === 409)
  const badRulingChoice = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: socialRuling.id, choice: 'pick', candidate_id: 'x' })
  ok('gist choices rejected on a ruling', badRulingChoice.status === 400, badRulingChoice.body)
  const accepted = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: socialRuling.id, choice: 'accept' })
  ok('DM accepts the outcome', accepted.status === 200 && accepted.body.resolved === 'accepted', accepted.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  ok('accepted ruling flows into the NPC reply (auto-dialogue on)',
    syncB.body.state.dialogue.lines.at(-1).npcId === tila.id && !syncB.body.state.dm.pendingReview,
    syncB.body.state.dialogue.lines.at(-1))

  const flipDo = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'do', text: 'I climb the outer wall.' })
  ok('do intent prompts a check', flipDo.body.resolved === 'check_prompted', flipDo.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const flipRoll = await act(p2, { action: 'roll_pending', adventure_id: advB, prompt_id: syncB.body.state.dialogue.pending.id })
  ok('outcome roll resolves into a ruling', flipRoll.status === 200, flipRoll.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const flipRuling = syncB.body.state.dm.pendingReview
  ok('do ruling staged', flipRuling?.kind === 'check_ruling', flipRuling)
  const flippedDecision = await act(gm, { action: 'review_decide', adventure_id: advB, review_id: flipRuling.id, choice: 'flip' })
  ok('DM flips the outcome', flippedDecision.status === 200 && flippedDecision.body.success === !flipRuling.success, flippedDecision.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const flippedLine = syncB.body.state.dialogue.lines.at(-1)
  ok('narration follows the flipped outcome',
    flippedLine.text.includes(flipRuling.success ? 'FAILS' : 'SUCCEEDS') && flippedLine.text.includes('DM override'), flippedLine)

  const checksAuto = await act(gm, {
    action: 'player_intent', adventure_id: advB, kind: 'dm_command', command: 'set_auto', auto_checks: true,
  })
  ok('DM switches auto-checks on', checksAuto.status === 200 && checksAuto.body.settings.autoChecks === true, checksAuto.body)
  const autoDo = await act(p2, { action: 'player_intent', adventure_id: advB, kind: 'do', text: 'I climb the tower steps.' })
  ok('check still prompts', autoDo.body.resolved === 'check_prompted', autoDo.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  const autoRoll = await act(p2, { action: 'roll_pending', adventure_id: advB, prompt_id: syncB.body.state.dialogue.pending.id })
  ok('auto-checks on -> outcome flows without a ruling', autoRoll.status === 200, autoRoll.body)
  syncB = await act(gm, { action: 'resync', adventure_id: advB })
  ok('no ruling staged, narration landed directly',
    !syncB.body.state.dm.pendingReview && syncB.body.state.dialogue.lines.at(-1).speaker === null,
    syncB.body.state.dialogue.lines.at(-1))

  ok('assist gate suite spent zero LLM calls', (await usageCount(advB)) === 0)

  console.log('\n[proposal pipeline]')
  const proposals = await serviceRest('GET', `proposals?adventure_id=eq.${advId}&select=type,status,approval_mode`)
  const autoTypes = new Set(proposals.filter((p) => p.status === 'auto_applied').map((p) => p.type))
  ok('auto_applied audit rows exist for rulings, npc replies, and narration',
    autoTypes.has('ruling') && autoTypes.has('npc_reply') && autoTypes.has('narration'), [...autoTypes])
  const playerProposals = await restAs(p2, 'GET', `proposals?adventure_id=eq.${advId}&select=id`)
  ok('players cannot read proposals', playerProposals.status === 200 && playerProposals.body.length === 0)
  const gmProposals = await restAs(gm, 'GET', `proposals?adventure_id=eq.${advId}&select=id`)
  ok('the DM-seat creator can read proposals', gmProposals.status === 200 && gmProposals.body.length > 0)

  const [pendingProposal] = await serviceRest('POST', 'proposals', {
    adventure_id: advId, type: 'test_pending', payload: {}, approval_mode: 'human', status: 'pending',
  })
  const decided = await act(gm, { action: 'decide_proposal', adventure_id: advId, proposal_id: pendingProposal.id, verdict: 'accepted' })
  ok('pending proposal decided', decided.status === 200 && decided.body.status === 'accepted', decided.body)
  const [staleProposal] = await serviceRest('POST', 'proposals', {
    adventure_id: advId, type: 'test_stale', payload: {}, approval_mode: 'human', status: 'pending',
    created_at: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  })
  const expired = await act(gm, { action: 'decide_proposal', adventure_id: advId, proposal_id: staleProposal.id, verdict: 'accepted' })
  ok('expired proposal cannot be applied', expired.status === 409, expired.body)
  const [staleRow] = await serviceRest('GET', `proposals?id=eq.${staleProposal.id}&select=status`)
  ok('expired status recorded', staleRow.status === 'expired')

  console.log('\n[isolation + zero spend]')
  const p2Sync = await act(p2, { action: 'resync', adventure_id: advId })
  ok('player resync still strips dm domain', p2Sync.body.state.dm === null)
  ok('players never see the pending-context stash', !JSON.stringify(p2Sync.body).includes('pendingContext'))
  ok('dispositions unreadable by players', (await restAs(p2, 'GET', `npc_dispositions?adventure_id=eq.${advId}&select=value`)).body.length === 0)
  ok('interactions unreadable by players', (await restAs(p2, 'GET', `npc_interactions?adventure_id=eq.${advId}&select=id`)).body.length === 0)
  ok('entire demo suite spent zero LLM calls', (await usageCount(advId)) === 0)

  console.log(`\nPASS (${pass} checks)`)
}

async function cleanup() {
  for (const id of Object.values(userIds)) if (id) await deleteUser(id)
}

main()
  .then(cleanup)
  .then(() => process.exit(0))
  .catch(async (err) => {
    console.error('\nFAIL:', err.message ?? err)
    await cleanup()
    process.exit(1)
  })
