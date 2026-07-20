// PAID full-AI live test - unlike the other suites this one SPENDS REAL OPENROUTER CREDITS
// (~$0.01 per run on the default model map). Run it manually, never in CI.
//
// Real LLM agents (demo: false) drive a small authored adventure end-to-end: session-start
// entry offer narration, NPC conversation (classifier + npc agent), insight checks, offer
// negotiation/acceptance, do-intent adjudication, narrate_next, the idle nudge, and objective
// completion. Asserts no line ever degrades to the mechanical consistency fallback and no
// consistency double-failure incidents are logged (the Phase 5 grounding regression).
// Spend-guarded: skips remaining LLM phases if usage_log cost crosses $1.50.
//
// Usage: node tests/integration/fullai-live.mjs
// Requires the same env as orchestration-live.mjs + OPENROUTER_API_KEY set on the deployed
// session function. Includes a 70s idle wait for the nudge phase (total runtime ~3 min).
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

const FALLBACK = 'The attempt is resolved; the outcome stands.'
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
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
    method: 'POST', headers: { apikey: anonKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`sign in failed: ${res.status}`)
  return body.access_token
}
async function serviceRest(method, path, payload) {
  const res = await fetch(`${url}/rest/v1/${path}`, {
    method, headers: { ...admin, Prefer: 'return=representation' },
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
const emails = { gm: `fullai-gm-${stamp}@example.com`, p2: `fullai-p2-${stamp}@example.com` }
const userIds = {}
let pass = 0
let fail = 0
function ok(label, condition, detail = '') {
  if (condition) { pass++; console.log(`  ok: ${label}`) }
  else { fail++; console.log(`  FAIL: ${label}${detail ? ` -- ${JSON.stringify(detail).slice(0, 400)}` : ''}`) }
}
function note(label, value) {
  console.log(`  note: ${label}: ${typeof value === 'string' ? value : JSON.stringify(value)}`)
}

async function main() {
  for (const [key, email] of Object.entries(emails)) userIds[key] = await createConfirmedUser(email)
  const gm = await signIn(emails.gm)
  const p2 = await signIn(emails.p2)
  await serviceRest('POST', 'user_settings?on_conflict=user_id', {
    user_id: userIds.gm, provider: 'openrouter',
  }).catch(() => {})
  console.log('setup: users created')

  // ---- Authored mini-adventure (real agents: demo false) ----
  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.gm, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'A coastal lighthouse has gone dark and ships are wrecking on the reefs.',
    status: 'guide_ready', demo: false, title: 'The Lantern of Greywater Deep',
    meta_loop: { premise: 'Greywater\'s lighthouse went dark a week ago; three ships have wrecked since, and the keeper is missing.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'The Dark Lantern', arc_summary: 'Find the keeper, relight the lantern.', status: 'active',
  })
  await serviceRest('POST', 'locations', {
    adventure_id: advId, chapter_id: chapter.id, name: 'The Salt-Wound Quay, Greywater',
    description: 'A storm-bitten fishing harbor beneath a dark lighthouse on the cliffs.',
  })
  const [objective] = await serviceRest('POST', 'objectives', {
    adventure_id: advId, chapter_id: chapter.id, index: 0, title: 'Relight the Greywater lantern',
    hidden_description: 'The keeper Elphin was dragged into the sea-caves by wreckers who profit from the wrecks.',
    reveal_state: 'hidden',
    completion_predicates: { all: [{ flag: 'lantern_relit', eq: true }] },
  })
  const [sereth] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Harbormistress Sereth Vane', role: 'npc',
    personality: { summary: 'iron-spined, guilt-ridden; blames herself for the third wreck' },
    description: 'Greywater\'s harbormistress; her own brother crewed the last ship to founder.',
    faction: 'greywater',
  })
  const [mordekai] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Mordekai', role: 'npc',
    personality: { summary: 'retired smuggler, superstitious, talks in half-truths' },
    description: 'An old smuggler who drinks at the quay and knows the sea-caves.',
    faction: 'greywater',
  })
  await serviceRest('POST', 'ingredients', [
    {
      adventure_id: advId, chapter_id: chapter.id, type: 'clue',
      content: { text: 'green lamplight seen in the sea-caves at low tide' },
      reveals: 'Wreckers signal from the sea-caves with a green lantern on wreck nights.',
      placement: { npc_id: mordekai.id },
    },
    {
      adventure_id: advId, chapter_id: chapter.id, type: 'secret',
      content: { text: 'the keeper was taken, not drowned' },
      reveals: 'Keeper Elphin was seen alive, rowed toward the caves bound at the wrists.',
      placement: { npc_id: mordekai.id, condition: 'successful persuasion or insight check' },
    },
  ])
  const [contract] = await serviceRest('POST', 'quest_contracts', {
    adventure_id: advId, chapter_id: chapter.id, label: 'Relight the Greywater lantern',
    giver_npc_id: sereth.id, is_entry: true,
    reward: { gold_floor: 60, gold_ceiling: 120, extras: [] },
    stakes: 'Every dark night claims another ship; her brother\'s was the third.',
    objective_ids: [objective.id],
  })
  await serviceRest('POST', 'endings', [
    {
      adventure_id: advId, index: 0, title: 'The Lantern Burns Again',
      description: 'The wreckers are routed and the lantern relit.', climax_summary: 'sketch', tone: 'hopeful',
      trigger_conditions: { summary: '', signals: [{ when: { objective_id: objective.id, outcome: 'completed' }, weight: 3, note: '' }] },
      exclusivity_group: 'main',
    },
    {
      adventure_id: advId, index: 1, title: 'Greywater Goes Dark',
      description: 'The coast surrenders to the wreckers.', climax_summary: 'sketch', tone: 'tragic',
      trigger_conditions: { summary: '', signals: [{ when: { npc_id: sereth.id, state: 'dead' }, weight: 4, note: '' }] },
      exclusivity_group: 'main',
    },
  ])

  const [gmChar] = await serviceRest('POST', 'characters', {
    user_id: userIds.gm, name: 'Kestrel', level: 1, is_complete: true,
    abilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 16 },
    skill_proficiencies: ['persuasion', 'stealth', 'acrobatics'], hp_max: 10, hp_current: 10,
  })
  const [p2Char] = await serviceRest('POST', 'characters', {
    user_id: userIds.p2, name: 'Dain', level: 1, is_complete: true,
    abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 14, cha: 8 },
    skill_proficiencies: ['athletics', 'insight', 'survival'], hp_max: 13, hp_current: 13,
  })

  const spentUsd = async () => {
    const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=cost_usd`)
    return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
  }
  const overBudget = async () => {
    const spent = await spentUsd()
    if (spent > 1.5) { console.log(`  !! spend guard tripped at $${spent.toFixed(4)} - skipping remaining LLM phases`); return true }
    return false
  }
  const incidents = async () =>
    serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.incident&select=payload`)
  const resyncState = async (token) => (await act(token, { action: 'resync', adventure_id: advId })).body.state
  const lastLines = (state, n = 3) => state.dialogue.lines.slice(-n).map((l) => `${l.speaker ?? '<narrator>'}: ${l.text}`)

  console.log('\n[lobby -> session start (real narrator + consistency)]')
  await act(gm, { action: 'activate', adventure_id: advId })
  const [{ invite_code: invite }] = await serviceRest('GET', `adventures?id=eq.${advId}&select=invite_code`)
  await act(p2, { action: 'join', invite_code: invite })
  await act(gm, { action: 'pick_character', adventure_id: advId, character_id: gmChar.id })
  await act(p2, { action: 'pick_character', adventure_id: advId, character_id: p2Char.id })
  await act(gm, { action: 'ready', adventure_id: advId, ready: true })
  await act(p2, { action: 'ready', adventure_id: advId, ready: true })
  const started = await act(gm, { action: 'start_session', adventure_id: advId })
  ok('session starts', started.status === 200, started.body)

  let state = await resyncState(gm)
  ok('entry offer staged', state.objectives.offers.length === 1, state.objectives.offers)
  const offerNarration = state.dialogue.lines.at(-1)
  ok('offer narration is real prose, not the mechanical fallback', offerNarration && offerNarration.text !== FALLBACK, offerNarration)
  note('opening narration', offerNarration?.text)

  console.log('\n[NPC conversation (real classifier + npc agent)]')
  if (!(await overBudget())) {
    const social = await act(gm, { action: 'start_social', adventure_id: advId, npc_ids: [sereth.id, mordekai.id] })
    ok('social scene staged with both NPCs', social.status === 200, social.body)
    const q1 = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'What happened to the lighthouse keeper? When did the light go out?' })
    ok('plain question processed', q1.status === 200, q1.body)
    note('q1 resolved as', q1.body.resolved)
    if (q1.body.resolved === 'check_prompted') {
      const r = await act(p2, { action: 'roll_pending', adventure_id: advId, prompt_id: q1.body.prompt?.id ?? (await resyncState(gm)).dialogue.pending?.id })
      note('rolled through the check', r.body.resolved ?? r.status)
    }
    state = await resyncState(gm)
    const npcSpoke = state.dialogue.lines.some((l) => l.npcId && l.text.length > 0)
    ok('an NPC replied in character', npcSpoke, lastLines(state))
    note('scene so far', lastLines(state, 2))

    const probe = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'I study Mordekai closely - is he hiding something about those caves?' })
    note('insight probe resolved as', probe.body.resolved)
    if (probe.body.resolved === 'check_prompted') {
      const pending = (await resyncState(gm)).dialogue.pending
      const r = await act(p2, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id })
      ok('insight check rolled and resolved', r.status === 200, r.body)
    }
    state = await resyncState(gm)
    note('after insight', lastLines(state, 2))
  }

  console.log('\n[offer negotiation + acceptance (real offer classifier)]')
  if (!(await overBudget())) {
    const haggle = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'Sixty gold is thin pay for wreckers and dark caves, Harbormistress. Make it ninety and we sail tonight.' })
    note('haggle resolved as', haggle.body.resolved)
    if (haggle.body.resolved === 'check_prompted') {
      const pending = (await resyncState(gm)).dialogue.pending
      const r = await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id })
      ok('negotiation persuasion rolled', r.status === 200, r.body)
      const neg = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.offer_negotiated&select=payload`)
      if (neg.length > 0) {
        ok('negotiated terms stay within authored bounds', neg[0].payload.to >= 60 && neg[0].payload.to <= 120, neg[0].payload)
      } else note('negotiation roll failed the check (terms unchanged) - valid outcome', '')
    }
    const accept = await act(p2, { action: 'player_intent', adventure_id: advId, kind: 'say', text: 'We accept the job. We will relight your lantern.' })
    ok('clear accept binds the party', accept.status === 200 && accept.body.resolved === 'offer_accepted', accept.body)
    state = await resyncState(gm)
    ok('quest active in the journal', state.objectives.quests?.length === 1 && state.objectives.quests[0].status === 'active', state.objectives.quests)
    ok('objective activated on acceptance', Boolean(state.objectives.currentId), state.objectives)
    const ended = await act(gm, { action: 'end_encounter', adventure_id: advId })
    ok('social scene ends (interaction summaries)', ended.status === 200, ended.body)
  }

  console.log('\n[do intent -> adjudicator -> outcome narration]')
  if (!(await overBudget())) {
    const climb = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'do', text: 'I scale the cliff path toward the dark lighthouse, keeping low against the wind.' })
    ok('do intent adjudicated', climb.status === 200, climb.body)
    note('adjudication', climb.body.resolved)
    if (climb.body.resolved === 'check_prompted') {
      let pending = (await resyncState(gm)).dialogue.pending
      if (pending?.kind === 'assist') {
        const claim = await act(p2, { action: 'claim_assist', adventure_id: advId, prompt_id: pending.id })
        ok('assist slot claimed by second PC', claim.status === 200, claim.body)
        pending = (await resyncState(gm)).dialogue.pending
      }
      if (pending?.kind === 'group') {
        await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id })
        const r2 = await act(p2, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id })
        ok('group check rolled by both PCs', r2.status === 200, r2.body)
      } else if (pending?.kind === 'check') {
        const roller = pending.actorCharacterId === p2Char.id ? p2 : gm
        const r = await act(roller, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id })
        ok('check rolled, outcome resolved', r.status === 200, r.body)
      } else if (pending) {
        note('unhandled prompt kind', pending.kind)
      }
    }
    state = await resyncState(gm)
    const outcomeLine = state.dialogue.lines.at(-1)
    ok('outcome narration is real prose, not fallback', outcomeLine && outcomeLine.text !== FALLBACK, outcomeLine)
    note('outcome narration', outcomeLine?.text)
  }

  console.log('\n[narrate_next (options + published beat)]')
  if (!(await overBudget())) {
    const narrated = await act(gm, { action: 'narrate_next', adventure_id: advId })
    ok('narrate_next returns options + text', narrated.status === 200 && (narrated.body.options?.length ?? 0) >= 3 && typeof narrated.body.text === 'string', narrated.body)
    ok('published beat is not the fallback', narrated.body.text !== FALLBACK, narrated.body.text)
    note('beat options', narrated.body.options)
    note('published beat', narrated.body.text)
  }

  console.log('\n[idle nudge - the beat that used to always fall back]')
  if (!(await overBudget())) {
    const setNudge = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_auto', nudge_minutes: 1 })
    ok('nudge threshold set to 1 minute', setNudge.status === 200, setNudge.body)
    console.log('  (waiting 70s for the table to go idle...)')
    await sleep(70000)
    const linesBefore = (await resyncState(gm)).dialogue.lines.length
    const nudge = await act(gm, { action: 'idle_nudge', adventure_id: advId })
    ok('idle nudge fires', nudge.status === 200 && nudge.body.resolved === 'nudged', nudge.body)
    state = await resyncState(gm)
    const nudgeLine = state.dialogue.lines.at(-1)
    ok('nudge published a fresh non-fallback line', state.dialogue.lines.length > linesBefore && nudgeLine && nudgeLine.text !== FALLBACK, nudgeLine)
    note('nudge narration', nudgeLine?.text)
  }

  console.log('\n[objective completion -> accomplishment narration]')
  if (!(await overBudget())) {
    const flag = await act(gm, { action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_flag', flag: 'lantern_relit', value: true })
    ok('completion flag set', flag.status === 200, flag.body)
    state = await resyncState(gm)
    ok('objective completed', state.dialogue.lines.some((l) => l.text.startsWith('Objective complete:')), lastLines(state))
    const completionLine = state.dialogue.lines.at(-1)
    ok('completion narration is real prose, not fallback', completionLine && completionLine.text !== FALLBACK, completionLine)
    note('completion narration', completionLine?.text)
  }

  console.log('\n[health of the whole run]')
  const incidentRows = await incidents()
  ok('no consistency double-failures across the run', incidentRows.every((i) => i.payload.kind !== 'consistency_double_failure'), incidentRows)
  const blocked = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.consistency_blocked&select=payload`)
  note('first-pass consistency blocks (regen recovered)', blocked.length)
  state = await resyncState(gm)
  const fallbackCount = state.dialogue.lines.filter((l) => l.text === FALLBACK).length
  ok('zero mechanical-fallback lines in the transcript', fallbackCount === 0, fallbackCount)

  console.log('\n[full transcript]')
  for (const l of state.dialogue.lines) console.log(`  ${l.speaker ?? '<narrator>'}: ${l.text}`)

  const usage = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=agent_role,model,cost_usd,prompt_tokens,completion_tokens`)
  const byRole = {}
  for (const u of usage) {
    byRole[u.agent_role] = byRole[u.agent_role] ?? { calls: 0, cost: 0 }
    byRole[u.agent_role].calls++
    byRole[u.agent_role].cost += Number(u.cost_usd) || 0
  }
  console.log('\n[spend]')
  for (const [role, s] of Object.entries(byRole)) console.log(`  ${role}: ${s.calls} calls, $${s.cost.toFixed(4)}`)
  console.log(`  TOTAL: ${usage.length} calls, $${(await spentUsd()).toFixed(4)}`)

  console.log(`\n${fail === 0 ? 'PASS' : 'FAILED'} (${pass} ok, ${fail} failed)`)

  await serviceRest('DELETE', `adventures?id=eq.${advId}`)
  await serviceRest('DELETE', `characters?id=eq.${gmChar.id}`)
  await serviceRest('DELETE', `characters?id=eq.${p2Char.id}`)
  for (const id of Object.values(userIds)) await deleteUser(id)
  console.log('cleanup complete')
  if (fail > 0) process.exitCode = 1
}

main().catch(async (err) => {
  console.error('\nFAILED:', err.message ?? err)
  for (const id of Object.values(userIds)) await deleteUser(id).catch(() => {})
  process.exitCode = 1
})
