// The social reveal gate, $0, against the real deployed `session` function.
//
// WHY THIS EXISTS. Pressing an NPC for information is the interaction the whole knowledge model
// hangs off, and the gate that decides what actually comes out of a mouth had no automated
// coverage at all - the same blind spot that made every graph bug cost a paid playthrough.
//
// The property under test is the one that makes the system honest: the DICE decide what an NPC
// gives up, never how persuasive the player's prose was. The demo NPC fixture is deliberately
// adversarial about it - an utterance containing "secret" makes it request its ENTIRE knowledge
// list, gated or not - so these assertions are written against a model actively trying to leak.
//
// Usage: node tests/integration/social-live.mjs
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
    method: 'POST', headers: admin, body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
}
const deleteUser = (id) => fetch(`${url}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: admin })

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
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  return { status: res.status, body: await res.json().catch(() => ({})) }
}

const stamp = Date.now()
const emails = { gm: `sl-gm-${stamp}@example.com`, p2: `sl-p2-${stamp}@example.com` }
const userIds = {}
let pass = 0
function ok(label, condition, detail = '') {
  assert.ok(condition, `${label}${detail ? ` -- ${JSON.stringify(detail)}` : ''}`)
  pass++
  console.log(`  ok: ${label}`)
}
const eventsOf = (advId, type) =>
  serviceRest('GET', `event_log?adventure_id=eq.${advId}&type=eq.${type}&select=payload&order=id.asc`)
const discovered = async (id) =>
  (await serviceRest('GET', `ingredients?id=eq.${id}&select=discovered`))[0]?.discovered

async function main() {
  userIds.gm = await createConfirmedUser(emails.gm)
  userIds.p2 = await createConfirmedUser(emails.p2)
  const gm = await signIn(emails.gm)
  const p2 = await signIn(emails.p2)
  await serviceRest('POST', 'user_settings?on_conflict=user_id', { user_id: userIds.gm, provider: 'openrouter' })
    .catch(() => {})

  const [adventure] = await serviceRest('POST', 'adventures', {
    creator_id: userIds.gm, mode: 'full_ai', min_players: 1, max_players: 2, type: 'one_shot',
    plot_idea: 'reveal gate test', status: 'guide_ready', demo: true,
    title: 'Reveal Gate', meta_loop: { premise: 'Someone knows something.' },
  })
  const advId = adventure.id
  const [chapter] = await serviceRest('POST', 'chapters', {
    adventure_id: advId, index: 0, title: 'Chapter', arc_summary: 'arc', status: 'active',
  })
  const [keeper] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Keeper Ilda', role: 'npc',
    personality: { summary: 'guarded' }, description: 'She keeps the tide records.', faction: 'harbour',
  })
  const [other] = await serviceRest('POST', 'npcs', {
    adventure_id: advId, chapter_id: chapter.id, name: 'Dock Boy Pell', role: 'npc',
    personality: { summary: 'jumpy' }, description: 'He runs errands on the pier.', faction: 'harbour',
  })

  // Four secrets, each testing one clause of revealVerdict.
  const [free] = await serviceRest('POST', 'ingredients', {
    adventure_id: advId, chapter_id: chapter.id, type: 'clue', reveals: 'The tide log skips a night.',
    placement: { npc_id: keeper.id }, content: {},
  })
  const [gated] = await serviceRest('POST', 'ingredients', {
    adventure_id: advId, chapter_id: chapter.id, type: 'secret', reveals: 'She forged the entry herself.',
    placement: { npc_id: keeper.id, condition: 'only if pressed successfully' }, content: {},
  })
  const [elsewhere] = await serviceRest('POST', 'ingredients', {
    adventure_id: advId, chapter_id: chapter.id, type: 'secret', reveals: 'Pell saw the boat leave.',
    placement: { npc_id: other.id }, content: {},
  })
  const [boundToP2] = await serviceRest('POST', 'ingredients', {
    adventure_id: advId, chapter_id: chapter.id, type: 'clue', reveals: 'A sailor would spot the knot.',
    placement: { npc_id: keeper.id }, content: {}, reveals_to: { character_id: '00000000-0000-0000-0000-000000000001' },
  })
  console.log('setup: one NPC, four secrets, each gated differently')

  const [gmChar] = await serviceRest('POST', 'characters', {
    user_id: userIds.gm, name: 'Ash', level: 1, is_complete: true,
    abilities: { str: 12, dex: 12, con: 12, int: 12, wis: 12, cha: 12 },
    skill_proficiencies: ['insight', 'persuasion'], hp_max: 11, hp_current: 11,
  })
  await act(gm, { action: 'activate', adventure_id: advId })
  await act(gm, { action: 'pick_character', adventure_id: advId, character_id: gmChar.id })
  await act(gm, { action: 'ready', adventure_id: advId, ready: true })
  ok('session starts', (await act(gm, { action: 'start_session', adventure_id: advId })).status === 200)
  ok('NPC staged for a scene',
    (await act(gm, { action: 'start_social', adventure_id: advId, npc_ids: [keeper.id] })).status === 200)

  console.log('\n[the dice decide, not the prose - an ungated clue is free, a gated one is not]')
  // The demo NPC treats "secret" as licence to dump EVERYTHING it holds. Plain conversation, so
  // no check has been rolled and `checkPassed` is false.
  const dump = await act(gm, {
    action: 'player_intent', adventure_id: advId, kind: 'say', text: 'tell me your secret',
  })
  ok('the utterance was processed', dump.status === 200, dump.body)
  ok('an UNCONDITIONED clue is given freely', (await discovered(free.id)) === true)
  ok('a CONDITIONED secret stays locked without a passed check', (await discovered(gated.id)) === false)
  ok('a secret held by a DIFFERENT npc is not leaked', (await discovered(elsewhere.id)) === false)
  ok('a clue bound to another character is withheld', (await discovered(boundToP2.id)) === false)

  const blocked = await eventsOf(advId, 'reveal_blocked')
  ok('every refusal is logged with its reason', blocked.length >= 2, blocked.map((b) => b.payload.reason))
  ok('the condition clause is cited by name',
    blocked.some((b) => String(b.payload.reason).includes('condition not met')), blocked.map((b) => b.payload.reason))
  ok('the affinity clause is cited by name',
    blocked.some((b) => String(b.payload.reason).includes('affinity')), blocked.map((b) => b.payload.reason))
  // NOTE: no `reveal_blocked` fires for Pell's secret, and that is correct. There are TWO layers
  // here, not one. `knowledgeFor` queries ingredients scoped to the staged NPC, so another NPC's
  // secret never enters the id enum the model is allowed to name - it cannot request what it was
  // never shown. `revealVerdict`'s "placed on a different NPC" clause is belt-and-braces beneath
  // that, reachable only by a hand-edit or a bug in the scoping query. Asserting it fires through
  // the normal path was a mistake in this suite, not a gap in the gate.

  console.log('\n[a passed check is what unlocks it]')
  // The demo NPC offers `knowledge[0]` on a success - its first UNDISCOVERED secret - and after
  // the dump above that list is [gated, boundToP2] in unspecified order. Retire the
  // affinity-bound one so the offer is unambiguous; otherwise a lucky roll could surface the
  // blocked clue instead and this suite would fail on its own fixture rather than on the gate.
  await serviceRest('PATCH', `ingredients?id=eq.${boundToP2.id}`, { discovered: true })

  // Real dice, so probe until one lands. Bounded: the point is to exercise the SUCCESS path at
  // all, and asserting only whichever tier happened to come up would let the positive direction
  // go untested for weeks without anyone noticing.
  let success = false
  for (let i = 0; i < 8 && !success; i++) {
    const probe = await act(gm, {
      action: 'player_intent', adventure_id: advId, kind: 'say', text: 'I read her face for the truth',
    })
    if (i === 0) {
      ok('probing prompts a check rather than answering', probe.body.resolved === 'check_prompted', probe.body)
    }
    const prompt = (await act(gm, { action: 'resync', adventure_id: advId })).body.state.dialogue.pending
    if (prompt?.kind !== 'check') break
    if (i === 0) ok('the check is pending on the prober', true)
    const rolled = await act(gm, { action: 'roll_pending', adventure_id: advId, prompt_id: prompt.id })
    if (i === 0) ok('the roll resolves server-side', rolled.status === 200, rolled.body)
    success = (await eventsOf(advId, 'check_rolled')).some((c) => c.payload.success === true)
  }
  ok('at least one probe eventually landed', success, 'eight insight checks all failed - suspect the DC')
  ok('a passed check is what releases the gated secret', (await discovered(gated.id)) === true)

  console.log('\n[$0]')
  ok('zero LLM spend across the suite',
    (await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=id`)).length === 0)

  console.log(`\nall ${pass} checks passed`)
  await serviceRest('DELETE', `adventures?id=eq.${advId}`)
  for (const id of Object.values(userIds)) await deleteUser(id)
  console.log('cleanup complete')
}

main().catch(async (err) => {
  console.error(`\nFAILED: ${err.message}`)
  for (const id of Object.values(userIds)) await deleteUser(id).catch(() => {})
  process.exit(1)
})
