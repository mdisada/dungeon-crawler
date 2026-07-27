// A/B harness for the quest-payout narration bug (2026-07-26).
//
// The live failure (run eb7fb2ad, N13): the payout narration invented a party action nobody took
// ("the charges are quiet now - disarmed by Dain's steady hands, the wire cut and coiled") and
// flipped the giver from hostile - he had just had the party shoved out by men with pick handles -
// to warmly counting gold into their palm.
//
// Rather than run a 20-minute playthrough per idea, this replays THAT EXACT CALL against the real
// end-state of that adventure under competing prompt variants, then scores each output against
// facts we know: the wire was never cut, the giver was hostile, the mystery was not solved.
//
// Usage: node tests/lab/ab-payout-prompt.mjs [adventure_id]

import { env, serviceRest } from './shared.mjs'

const ADV = process.argv[2] ?? 'eb7fb2ad-84ed-4bdd-bc9b-01f730778c35'
const MODEL = 'z-ai/glm-5.2'

const NARRATOR_BASE =
  'You narrate a tabletop RPG. Second person, present tense, 2-5 sentences. Never invent facts ' +
  'about named NPCs, items or places beyond the given context. Never mention dice, rolls, checks ' +
  'or game mechanics. Never presume the party\'s feelings or decisions.'
const SYSTEM = NARRATOR_BASE +
  ' Narrate the resolved outcome and let the scene settle where it naturally lands - never force ' +
  'a closing question, but never strand the players either.'

async function call(system, user) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.openRouterKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODEL,
      messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
      max_tokens: 400,
    }),
  })
  const body = await res.json()
  return body.choices?.[0]?.message?.content?.trim() ?? `(no output: ${JSON.stringify(body).slice(0, 200)})`
}

const events = await serviceRest(
  'GET', `event_log?adventure_id=eq.${ADV}&select=type,payload&order=id&limit=600`)
const npcs = await serviceRest('GET', `npcs?adventure_id=eq.${ADV}&select=id,name`)
const giver = npcs[0]?.name ?? 'the giver'

// What the party ACTUALLY did, in the engine's own words - the facts the prompt never had.
const deeds = events
  .filter((e) => ['intent_submitted', 'encounter_resolved', 'objective_completed', 'milestone_reached'].includes(e.type))
  .slice(-14)
  .map((e) => {
    const p = e.payload ?? {}
    if (e.type === 'intent_submitted') return `- a player said/did: "${String(p.text ?? '').slice(0, 90)}"`
    if (e.type === 'encounter_resolved') return `- an encounter "${p.label}" ended in ${p.tier}`
    if (e.type === 'objective_completed') return `- objective completed: ${p.title}`
    return `- milestone: ${p.milestone}`
  })
  .join('\n')

// The last thing that passed between the party and the giver, so his manner cannot silently reset.
const lastNpcBeat = events
  .filter((e) => e.type === 'narration_published')
  .slice(-14, -12)
  .map((e) => String(e.payload.text).replace(/\s+/g, ' ').slice(0, 400))
  .join(' … ') || '(none)'

const label = 'Uncover the truth below Black Sough'
const gold = 60

const VARIANTS = {
  // What ships today.
  A_current: () =>
    `The party completes the job "${label}" for ${giver}. ${giver} pays the promised ${gold} gp. ` +
    'Narrate the resolution and end at a concrete decision point about what comes next.',

  // H1: the vacuum is the problem - hand it the actual event log.
  B_grounded: () =>
    `The party completes the job "${label}" for ${giver}. ${giver} pays the promised ${gold} gp. ` +
    `What ACTUALLY happened, in order (narrate only from this - the party did nothing else):\n${deeds}\n` +
    'Narrate the resolution and end at a concrete decision point about what comes next.',

  // H2: the ASK is the problem - stop requesting a "resolution".
  C_reframed: () =>
    `${giver} settles up with the party for "${label}" and hands over ${gold} gp. ` +
    'Narrate ONLY the handover itself: the exchange, and the manner of the person doing it. ' +
    'You do not know how the job went - do NOT state what the party accomplished, do NOT ' +
    'describe any action the party took, and do NOT declare anything solved or safe. ' +
    'End on the moment the money changes hands.',

  // H3: character reversal is its own bug - pass the last thing that happened between them.
  D_disposition: () =>
    `${giver} settles up with the party for "${label}" and hands over ${gold} gp. ` +
    `The last exchange between ${giver} and the party went like this: "${lastNpcBeat}"\n` +
    `Keep ${giver}'s manner consistent with that - people do not change temperament because a ` +
    'debt is paid. Narrate only the handover, not what the party achieved.',

  // H4: both fixes together.
  E_grounded_reframed: () =>
    `${giver} settles up with the party for "${label}" and hands over ${gold} gp. ` +
    `What ACTUALLY happened, in order (the party did nothing else):\n${deeds}\n` +
    `The last exchange between ${giver} and the party: "${lastNpcBeat}"\n` +
    'Narrate ONLY the handover: the exchange and the manner of the person doing it, consistent ' +
    'with that last exchange. Do NOT state what the party accomplished, do NOT describe actions ' +
    'they did not take, and do NOT declare anything solved or safe.',
}

const JUDGE_SYSTEM =
  'You check a passage of RPG narration against a list of facts. Answer ONLY with JSON: ' +
  '{"invented_action": true|false, "invented_what": string, "giver_friendly": true|false, ' +
  '"claims_solved": true|false}. "invented_action" is true if the passage describes the party ' +
  'doing something that is NOT in the fact list (e.g. cutting a wire, disarming charges). ' +
  '"giver_friendly" is true if the quest-giver is warm, grateful or cooperative. ' +
  '"claims_solved" is true if the passage states the mystery/threat is resolved or the place is safe.'

console.log(`=== A/B: quest payout narration (${MODEL}) ===`)
console.log(`facts the party actually produced:\n${deeds}\n`)

for (const [name, build] of Object.entries(VARIANTS)) {
  const out = await call(SYSTEM, build())
  const verdict = await call(JUDGE_SYSTEM, `FACTS:\n${deeds}\n\nPASSAGE:\n${out}`)
  console.log(`\n---------- ${name} ----------`)
  console.log(out.replace(/\s+/g, ' '))
  console.log(`JUDGE: ${verdict.replace(/\s+/g, ' ').slice(0, 300)}`)
}
