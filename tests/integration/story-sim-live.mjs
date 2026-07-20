// PAID full-game simulation on an EXISTING authored adventure: an LLM player plays against
// the deployed full-AI DM until an ending commits, the turn cap, the time box, or the spend
// guard. The adventure's mutable state is snapshotted to story-sim-snapshot.json before play
// and restored afterward unless --keep is passed; --resume continues a kept session in a new
// process (multi-segment runs); --restore restores from the snapshot and exits.
//
// Usage:
//   node tests/integration/story-sim-live.mjs <adventureId> [maxTurns] [outFile] --keep   # segment 1
//   node tests/integration/story-sim-live.mjs --resume --keep [maxTurns]                  # more segments
//   node tests/integration/story-sim-live.mjs --restore                                   # cleanup
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'

function readEnvVar(path, name) {
  const text = readFileSync(path, 'utf8')
  const match = text.match(new RegExp(`^${name}="?(.+?)"?$`, 'm'))
  if (!match) throw new Error(`${name} not found in ${path}`)
  return match[1].trim()
}

const url = readEnvVar('frontend/.env.local', 'VITE_SUPABASE_URL')
const anonKey = readEnvVar('frontend/.env.local', 'VITE_SUPABASE_PUBLISHABLE_KEY')
const serviceKey = readEnvVar('backend/.env', 'SUPABASE_SERVICE_ROLE_KEY')
const openRouterKey = readEnvVar('frontend/.env.local', 'OPENROUTER_API_KEY')
const admin = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const FLAGS = new Set(process.argv.slice(2).filter((a) => a.startsWith('--')))
const POS = process.argv.slice(2).filter((a) => !a.startsWith('--'))
const RESTORE_ONLY = FLAGS.has('--restore')
const RESUME = FLAGS.has('--resume')
const KEEP = FLAGS.has('--keep')
const ADV_ID = POS[0] ?? '8e70fe49-7c0c-4b10-bbf6-d027699631af'
const MAX_TURNS = Number((RESUME ? POS[0] : POS[1]) ?? 30)
const OUT = (RESUME ? POS[1] : POS[2]) ?? 'tests/integration/story-sim-transcript.txt'
const SNAP_FILE = 'tests/integration/story-sim-snapshot.json'
const SPEND_CAP = 1.5
const TIME_BOX_MS = 6.5 * 60_000

let password = `Test-password-${Date.now()}!`
let playerSpend = 0
function out(line) {
  console.log(line)
  appendFileSync(OUT, line + '\n')
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
async function createConfirmedUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: 'POST', headers: admin,
    body: JSON.stringify({ email, password, email_confirm: true }),
  })
  const body = await res.json()
  if (!res.ok) throw new Error(`admin create user failed: ${res.status} ${JSON.stringify(body)}`)
  return body.id
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

const ID_TABLES = ['quest_offers', 'hooks', 'proposals', 'npc_interactions', 'checkpoints', 'adventure_members']

async function takeSnapshot(aid) {
  const [adv] = await serviceRest('GET', `adventures?id=eq.${aid}&select=creator_id,status,min_players,ending_scores,committed_ending_id`)
  const stateRows = await serviceRest('GET', `adventure_state?adventure_id=eq.${aid}&select=state,state_version`)
  const loops = await serviceRest('GET', `core_loops?adventure_id=eq.${aid}&select=id,type,status,stack_position,current_beat_id,custom_label`)
  const beats = loops.length
    ? await serviceRest('GET', `beats?core_loop_id=in.(${loops.map((l) => l.id).join(',')})&select=id,status,core_loop_id`)
    : []
  const snap = {
    adventureId: aid,
    adventure: adv,
    state: stateRows[0] ?? null,
    objectives: await serviceRest('GET', `objectives?adventure_id=eq.${aid}&select=id,reveal_state`),
    ingredients: await serviceRest('GET', `ingredients?adventure_id=eq.${aid}&select=id,discovered`),
    endings: await serviceRest('GET', `endings?adventure_id=eq.${aid}&select=id,status`),
    sessions: await serviceRest('GET', `sessions?adventure_id=eq.${aid}&select=id,ended_at`),
    core_loops: loops,
    beats,
    npc_dispositions: await serviceRest('GET', `npc_dispositions?adventure_id=eq.${aid}&select=npc_id,character_id,adventure_id,value`),
    meta_loop: (await serviceRest('GET', `meta_loop?adventure_id=eq.${aid}&select=*`))[0] ?? null,
    ids: {},
    eventWatermark: 0,
    created: {},
  }
  for (const table of ID_TABLES) {
    snap.ids[table] = (await serviceRest('GET', `${table}?adventure_id=eq.${aid}&select=id`)).map((r) => r.id)
  }
  const lastEvent = await serviceRest('GET', `event_log?adventure_id=eq.${aid}&select=id&order=id.desc&limit=1`)
  snap.eventWatermark = lastEvent[0]?.id ?? 0
  return snap
}

async function restore(snap) {
  const aid = snap.adventureId
  const step = async (label, fn) => {
    try { await fn() } catch (err) { console.error(`restore: ${label} FAILED - ${err.message}`) }
  }
  await step('event_log', () => serviceRest('DELETE', `event_log?adventure_id=eq.${aid}&id=gt.${snap.eventWatermark}`))
  for (const table of ID_TABLES) {
    await step(table, async () => {
      const now = await serviceRest('GET', `${table}?adventure_id=eq.${aid}&select=id`)
      const fresh = now.map((r) => r.id).filter((id) => !snap.ids[table].includes(id))
      if (fresh.length) await serviceRest('DELETE', `${table}?id=in.(${fresh.join(',')})`)
    })
  }
  await step('beats+loops', async () => {
    const loopsNow = await serviceRest('GET', `core_loops?adventure_id=eq.${aid}&select=id`)
    if (loopsNow.length) {
      const beatsNow = await serviceRest('GET', `beats?core_loop_id=in.(${loopsNow.map((l) => l.id).join(',')})&select=id`)
      const freshBeats = beatsNow.map((b) => b.id).filter((id) => !snap.beats.some((b) => b.id === id))
      if (freshBeats.length) await serviceRest('DELETE', `beats?id=in.(${freshBeats.join(',')})`)
    }
    const freshLoops = loopsNow.map((l) => l.id).filter((id) => !snap.core_loops.some((l) => l.id === id))
    if (freshLoops.length) await serviceRest('DELETE', `core_loops?id=in.(${freshLoops.join(',')})`)
    for (const b of snap.beats) await serviceRest('PATCH', `beats?id=eq.${b.id}`, { status: b.status })
    for (const l of snap.core_loops) {
      await serviceRest('PATCH', `core_loops?id=eq.${l.id}`, {
        status: l.status, current_beat_id: l.current_beat_id, stack_position: l.stack_position,
      })
    }
  })
  await step('sessions', async () => {
    const now = await serviceRest('GET', `sessions?adventure_id=eq.${aid}&select=id`)
    const fresh = now.map((s) => s.id).filter((id) => !snap.sessions.some((s) => s.id === id))
    if (fresh.length) await serviceRest('DELETE', `sessions?id=in.(${fresh.join(',')})`)
    for (const s of snap.sessions) await serviceRest('PATCH', `sessions?id=eq.${s.id}`, { ended_at: s.ended_at })
  })
  await step('npc_dispositions', async () => {
    await serviceRest('DELETE', `npc_dispositions?adventure_id=eq.${aid}`)
    if (snap.npc_dispositions.length) await serviceRest('POST', 'npc_dispositions', snap.npc_dispositions)
  })
  for (const o of snap.objectives) {
    await step(`objective ${o.id}`, () => serviceRest('PATCH', `objectives?id=eq.${o.id}`, { reveal_state: o.reveal_state }))
  }
  for (const i of snap.ingredients) {
    await step(`ingredient ${i.id}`, () => serviceRest('PATCH', `ingredients?id=eq.${i.id}`, { discovered: i.discovered }))
  }
  await step('new ingredients', async () => {
    const before = new Set(snap.ingredients.map((i) => i.id))
    const now = await serviceRest('GET', `ingredients?adventure_id=eq.${aid}&select=id`)
    const fresh = now.map((i) => i.id).filter((id) => !before.has(id))
    if (fresh.length) await serviceRest('DELETE', `ingredients?id=in.(${fresh.join(',')})`)
  })
  for (const e of snap.endings) {
    await step(`ending ${e.id}`, () => serviceRest('PATCH', `endings?id=eq.${e.id}`, { status: e.status }))
  }
  await step('adventure_state', async () => {
    if (snap.state) {
      await serviceRest('PATCH', `adventure_state?adventure_id=eq.${aid}`, {
        state: snap.state.state, state_version: snap.state.state_version,
      })
    } else {
      await serviceRest('DELETE', `adventure_state?adventure_id=eq.${aid}`)
    }
  })
  await step('meta_loop', async () => {
    await serviceRest('DELETE', `meta_loop?adventure_id=eq.${aid}`)
    if (snap.meta_loop) await serviceRest('POST', 'meta_loop', snap.meta_loop)
  })
  await step('adventure row', () => serviceRest('PATCH', `adventures?id=eq.${aid}`, {
    creator_id: snap.adventure.creator_id, status: snap.adventure.status, min_players: snap.adventure.min_players,
    ending_scores: snap.adventure.ending_scores, committed_ending_id: snap.adventure.committed_ending_id,
  }))
  if (snap.created.contractId) {
    await step('sim contract', () => serviceRest('DELETE', `quest_contracts?id=eq.${snap.created.contractId}`))
  }
  if (snap.created.characterId) {
    await step('sim character', () => serviceRest('DELETE', `characters?id=eq.${snap.created.characterId}`))
  }
  if (snap.created.userId) {
    await step('sim user', () => fetch(`${url}/auth/v1/admin/users/${snap.created.userId}`, { method: 'DELETE', headers: admin }))
  }
  console.log('restore complete')
}

const PLAYER_SYSTEM =
  'You are the sole player in a D&D-style game run by an AI DM. Decide the next move. ' +
  'Reply ONLY JSON: {"kind": "say"|"do", "text": string}. "say" = spoken words; "do" = a ' +
  'physical/exploratory action. Play purposefully toward the current quest: answer questions ' +
  'you are asked, make concrete decisions at forks, follow up on revealed clues, and take ' +
  'decisive physical action when talk is exhausted. If a quest offer is open, respond to it ' +
  'in-fiction. Never repeat an approach that just failed; never stall. 1-2 sentences, first person.'

async function playerMove(context) {
  const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'deepseek/deepseek-v4-flash',
      messages: [
        { role: 'system', content: PLAYER_SYSTEM },
        { role: 'user', content: context },
      ],
      max_tokens: 200,
      usage: { include: true },
      reasoning: { enabled: false },
    }),
  })
  const json = await res.json()
  playerSpend += Number(json.usage?.cost ?? 0)
  const content = json.choices?.[0]?.message?.content ?? ''
  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim()
  try {
    const parsed = JSON.parse(cleaned.slice(cleaned.indexOf('{'), cleaned.lastIndexOf('}') + 1))
    if ((parsed.kind === 'say' || parsed.kind === 'do') && typeof parsed.text === 'string' && parsed.text.trim()) {
      return { kind: parsed.kind, text: parsed.text.trim().slice(0, 400) }
    }
  } catch { /* fall through */ }
  return { kind: 'do', text: 'We press on with the task at hand.' }
}

const EVENT_TYPES = new Set([
  'beat_opened', 'beat_exit_met', 'objective_completed', 'objective_revealed', 'scene_travel',
  'scene_effect_rejected', 'milestone_reached', 'encounter_started', 'encounter_resolved',
  'encounter_opened', 'encounter_attempt', 'entry_mapped', 'encounter_talk', 'hint_given',
  'offer_staged', 'offer_accepted', 'offer_declined', 'offer_negotiated', 'quest_completed',
  'loop_pivot_applied', 'loop_pivot_proposed', 'ending_leading_changed', 'ending_committed',
  'ending_commit_blocked', 'story_event', 'day_advanced', 'antagonist_advanced',
  'consistency_blocked', 'incident', 'social_started', 'social_ended', 'check_prompted', 'check_rolled',
])

async function main() {
  if (RESTORE_ONLY) {
    await restore(JSON.parse(readFileSync(SNAP_FILE, 'utf8')))
    return
  }

  let snap, gm, aid, playerName, simChar
  if (RESUME) {
    snap = JSON.parse(readFileSync(SNAP_FILE, 'utf8'))
    aid = snap.adventureId
    password = snap.created.password
    gm = await signIn(snap.created.email)
    const [char] = await serviceRest('GET', `characters?id=eq.${snap.created.characterId}&select=id,name`)
    simChar = char
    playerName = char.name
    appendFileSync(OUT, `\n=== RESUMED SEGMENT - ${new Date().toISOString()} ===\n`)
  } else {
    aid = ADV_ID
    const [advRow] = await serviceRest('GET', `adventures?id=eq.${aid}&select=title`)
    writeFileSync(OUT, `=== FULL-GAME SIMULATION on "${advRow.title}" (${aid}) - ${new Date().toISOString()} ===\n` +
      `LLM player (deepseek-v4-flash) vs the deployed full-AI DM. Max ${MAX_TURNS} turns / ${Math.round(TIME_BOX_MS / 60000)} min per segment.\n\n`)
    snap = await takeSnapshot(aid)
    writeFileSync(SNAP_FILE, JSON.stringify(snap, null, 2))
    console.log(`snapshot saved to ${SNAP_FILE}`)
  }

  try {
    if (!RESUME) {
      const email = `storysim-${Date.now()}@example.com`
      snap.created.userId = await createConfirmedUser(email)
      snap.created.email = email
      snap.created.password = password
      writeFileSync(SNAP_FILE, JSON.stringify(snap, null, 2))
      gm = await signIn(email)
      await serviceRest('POST', 'user_settings?on_conflict=user_id', { user_id: snap.created.userId, provider: 'openrouter' }).catch(() => {})

      const [sourceChar] = await serviceRest('GET', 'characters?is_complete=eq.true&select=*&limit=1')
      if (!sourceChar) throw new Error('no complete character found to clone')
      const clone = { ...sourceChar }
      delete clone.id
      delete clone.created_at
      delete clone.updated_at
      clone.user_id = snap.created.userId
      clone.locked_adventure_id = null
      ;[simChar] = await serviceRest('POST', 'characters', clone)
      snap.created.characterId = simChar.id
      playerName = simChar.name
      out(`(playing as ${playerName}, a cloned copy of an existing character)`)

      const contracts = await serviceRest('GET', `quest_contracts?adventure_id=eq.${aid}&is_entry=eq.true&select=id`)
      if (contracts.length === 0) {
        const [chapter] = await serviceRest('GET', `chapters?adventure_id=eq.${aid}&select=id&order=index&limit=1`)
        const [firstObjective] = await serviceRest('GET', `objectives?adventure_id=eq.${aid}&chapter_id=eq.${chapter.id}&select=id,title&order=index&limit=1`)
        const [giver] = await serviceRest('GET', `npcs?adventure_id=eq.${aid}&chapter_id=eq.${chapter.id}&select=id,name&limit=1`)
        const [contract] = await serviceRest('POST', 'quest_contracts', {
          adventure_id: aid, chapter_id: chapter.id, label: firstObjective.title,
          giver_npc_id: giver.id, is_entry: true,
          reward: { gold_floor: 40, gold_ceiling: 90, extras: [] },
          stakes: 'The trouble grows worse each day it goes unanswered.',
          objective_ids: [firstObjective.id],
        })
        snap.created.contractId = contract.id
        out(`(seeded a temporary entry contract via ${giver.name} - the guide predates Stage 6 contracts)`)
      }
      writeFileSync(SNAP_FILE, JSON.stringify(snap, null, 2))

      await serviceRest('PATCH', `adventures?id=eq.${aid}`, { creator_id: snap.created.userId, min_players: 1 })
      for (const s of snap.sessions.filter((s) => s.ended_at === null)) {
        await serviceRest('PATCH', `sessions?id=eq.${s.id}`, { ended_at: new Date().toISOString() })
        out(`(closed lingering open session ${s.id} - will be restored)`)
      }
    }

    const spentUsd = async () => {
      const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${aid}&user_id=eq.${snap.created.userId}&select=cost_usd`)
      return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0)
    }
    const resyncState = async () => (await act(gm, { action: 'resync', adventure_id: aid })).body.state

    const seenLines = new Set()
    let lastEventId = snap.eventWatermark
    if (RESUME) {
      const cur = await resyncState()
      for (const l of cur.dialogue.lines) seenLines.add(l.id)
      const last = await serviceRest('GET', `event_log?adventure_id=eq.${aid}&select=id&order=id.desc&limit=1`)
      lastEventId = last[0]?.id ?? lastEventId
    }
    async function drain() {
      const state = await resyncState()
      for (const line of state.dialogue.lines) {
        if (seenLines.has(line.id)) continue
        seenLines.add(line.id)
        out(`${line.speaker ?? 'DM'}: ${line.text}`)
      }
      const events = await serviceRest(
        'GET',
        `event_log?adventure_id=eq.${aid}&id=gt.${lastEventId}&order=id.asc&select=id,type,payload`,
      )
      for (const e of events) {
        lastEventId = Math.max(lastEventId, e.id)
        if (!EVENT_TYPES.has(e.type)) continue
        const p = e.payload ?? {}
        const bits = ['name', 'label', 'title', 'tag', 'milestone', 'skill', 'total', 'success', 'trigger', 'to', 'response', 'proposed']
          .map((k) => (p[k] !== undefined && p[k] !== null ? `${k}=${p[k]}` : null))
          .filter(Boolean)
          .join(' ')
        out(`   [${e.type}]${bits ? ' ' + bits : ''}`)
      }
      return state
    }

    async function resolvePendingPrompt(state) {
      const pending = state.dialogue.pending
      if (!pending) return state
      let resp
      if (pending.kind === 'assist') {
        const wait = new Date(pending.deadline).getTime() - Date.now() + 2000
        out(`   (assist prompt, no second PC - waiting ${Math.max(0, Math.round(wait / 1000))}s for expiry)`)
        if (wait > 0) await sleep(wait)
        resp = await act(gm, { action: 'resolve_pending', adventure_id: aid, prompt_id: pending.id })
      } else {
        resp = await act(gm, { action: 'roll_pending', adventure_id: aid, prompt_id: pending.id })
      }
      if (resp.status !== 200) out(`   [prompt ${pending.kind} -> ${resp.status}] ${JSON.stringify(resp.body).slice(0, 180)}`)
      let next = await drain()
      if (next.dialogue.pending?.id === pending.id) {
        const wait = new Date(pending.deadline).getTime() - Date.now() + 2000
        out(`   (prompt survived - sweeping via expiry in ${Math.max(0, Math.round(wait / 1000))}s)`)
        if (wait > 0) await sleep(Math.min(wait, 65000))
        const sweep = await act(gm, { action: 'resolve_pending', adventure_id: aid, prompt_id: pending.id })
        if (sweep.status !== 200) out(`   [sweep -> ${sweep.status}] ${JSON.stringify(sweep.body).slice(0, 180)}`)
        next = await drain()
      }
      return next
    }

    function buildContext(state) {
      const quest = state.objectives.quests?.[0]
      const offer = state.objectives.offers?.[0]
      const currentObjective = state.objectives.list.find((o) => o.id === state.objectives.currentId)
      const recent = state.dialogue.lines.slice(-12).map((l) => `${l.speaker ?? 'DM'}: ${l.text}`)
      return [
        `You are ${playerName}. Scene: ${state.scene.locationName || 'unknown'} (${state.scene.mode}), day ${state.scene.day}. Party gold: ${state.players.gold}.`,
        currentObjective ? `Current objective: ${currentObjective.title}` : 'No objective yet.',
        quest ? `Active quest: ${quest.label} (${quest.giverName}, ${quest.gold} gp)` : '',
        offer ? `OPEN OFFER awaiting your answer: ${offer.label} (${offer.giverName}, ${offer.gold} gp). Stakes: ${offer.stakes}` : '',
        state.dialogue.speakers.length > 0 ? `In conversation with: ${state.dialogue.speakers.map((s) => s.name).join(', ')}` : '',
        `Recent transcript:\n${recent.join('\n')}`,
        'What do you do next?',
      ].filter(Boolean).join('\n')
    }

    let state
    if (!RESUME) {
      out('--- SETUP: session start ---')
      const activated = await act(gm, { action: 'activate', adventure_id: aid })
      if (activated.status !== 200) throw new Error(`activate failed: ${JSON.stringify(activated.body)}`)
      const picked = await act(gm, { action: 'pick_character', adventure_id: aid, character_id: simChar.id })
      if (picked.status !== 200) throw new Error(`pick_character failed: ${JSON.stringify(picked.body)}`)
      const readied = await act(gm, { action: 'ready', adventure_id: aid, ready: true })
      if (readied.status !== 200) throw new Error(`ready failed: ${JSON.stringify(readied.body)}`)
      const started = await act(gm, { action: 'start_session', adventure_id: aid })
      if (started.status !== 200) throw new Error(`session start failed: ${JSON.stringify(started.body)}`)
      state = await drain()
    } else {
      state = await drain()
    }

    const deadline = Date.now() + TIME_BOX_MS
    let endingReached = false
    let consecutiveErrors = 0
    for (let turn = 1; turn <= MAX_TURNS; turn++) {
      if (Date.now() > deadline) {
        out(`\n!! time box reached - stopping at turn ${turn}`)
        break
      }
      const spent = (await spentUsd()) + playerSpend
      if (spent > SPEND_CAP) {
        out(`\n!! spend guard tripped at $${spent.toFixed(4)} - stopping`)
        break
      }
      state = await resolvePendingPrompt(state)

      const move = await playerMove(buildContext(state))
      out(`\n--- turn ${turn} ---`)
      out(`>> ${playerName.toUpperCase()} (${move.kind}): ${move.text}`)
      let resp = await act(gm, { action: 'player_intent', adventure_id: aid, kind: move.kind, text: move.text })
      if (resp.status === 409) {
        out(`   [server 409] ${resp.body.error} - retrying once in 5s`)
        await sleep(5000)
        resp = await act(gm, { action: 'player_intent', adventure_id: aid, kind: move.kind, text: move.text })
      }
      if (resp.status !== 200) {
        out(`   [server ${resp.status}] ${JSON.stringify(resp.body).slice(0, 200)}`)
        consecutiveErrors++
        if (consecutiveErrors >= 3) {
          out('\n!! three consecutive server errors - aborting the run')
          break
        }
      } else {
        consecutiveErrors = 0
      }

      state = await drain()
      state = await resolvePendingPrompt(state)

      const committed = await serviceRest('GET', `adventures?id=eq.${aid}&select=committed_ending_id`)
      if (committed[0]?.committed_ending_id) {
        out('\n*** ENDING COMMITTED ***')
        endingReached = true
        await drain()
        break
      }
    }

    out('\n=== SEGMENT END: STORY STATE ===')
    const objectives = await serviceRest('GET', `objectives?adventure_id=eq.${aid}&select=title,reveal_state&order=index`)
    for (const o of objectives) out(`objective: ${o.title} [${o.reveal_state}]`)
    const endings = await serviceRest('GET', `endings?adventure_id=eq.${aid}&select=title,status&order=index`)
    for (const e of endings) out(`ending: ${e.title} [${e.status}]`)
    out(`ending reached: ${endingReached}`)
    const finalState = await resyncState()
    out(`scene: ${finalState?.scene?.locationName} (${finalState?.scene?.mode}), day ${finalState?.scene?.day}, gold ${finalState?.players?.gold}`)

    const usage = await serviceRest('GET', `usage_log?adventure_id=eq.${aid}&user_id=eq.${snap.created.userId}&select=agent_role,cost_usd`)
    const byRole = {}
    for (const u of usage) {
      byRole[u.agent_role] = byRole[u.agent_role] ?? { calls: 0, cost: 0 }
      byRole[u.agent_role].calls++
      byRole[u.agent_role].cost += Number(u.cost_usd) || 0
    }
    out('\n=== SPEND (cumulative DM agents + this segment player) ===')
    for (const [role, s] of Object.entries(byRole)) out(`${role}: ${s.calls} calls, $${s.cost.toFixed(4)}`)
    out(`player agent (this segment): $${playerSpend.toFixed(4)}`)
    out(`TOTAL DM spend: $${(await spentUsd()).toFixed(4)}`)
  } finally {
    if (KEEP) {
      console.log('\n--keep: leaving the sim session in place. Continue with --resume, clean up with --restore.')
    } else {
      console.log('\nrestoring adventure to its pre-sim state...')
      await restore(snap)
    }
  }
}

main().catch((err) => {
  console.error('\nSIM FAILED:', err.message ?? err)
  console.error('If the adventure was left modified, run: node tests/integration/story-sim-live.mjs --restore')
  process.exitCode = 1
})
