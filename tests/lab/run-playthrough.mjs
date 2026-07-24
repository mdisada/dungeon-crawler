// Executes ONE lab run end-to-end: throwaway users -> (guide generation | existing adventure)
// -> simulated play with the LLM player agent -> compact analysis. PAID: spends real
// OpenRouter credits, bounded by config.budget_usd. Structure follows the proven
// tests/integration/multichapter-playtest.mjs flow; the differences are the config-driven
// recipe, the context-aware player, and the structured dual log.
import { writeFileSync } from 'node:fs'

import { createRunLogger } from './lab-log.mjs'
import { checkInvariants } from './invariants.mjs'
import { completeActiveObjective } from './autocomplete.mjs'
import { generatePlayerTurn, pickQuality } from './player-agent.mjs'
import { act, createConfirmedUser, pipeline, seededRng, serviceRest, signIn, sleep } from './shared.mjs'

const FALLBACK = 'The attempt is resolved; the outcome stands.'
/** Turns between mid-run spine checks. Cheap (2 reads); the point is failing in minutes. */
const PREFLIGHT_EVERY = 15
const DEFAULTS = {
  type: 'one_shot', party_size: 1, quality: 'mixed', turns: 24,
  budget_usd: 0.75, model: 'google/gemini-2.5-flash-lite',
}

/** Mirror of pinTestModels (tests/integration/test-model-map.mjs) for a configurable model. */
const AGENT_ROLES = [
  'narrator', 'npc_agent', 'adjudicator', 'loop_classifier', 'encounter_designer',
  'npc_tactician', 'story_director', 'ingredient_generator', 'beat_planner', 'hook_weaver',
  'meta_loop_steward', 'consistency_checker', 'summarizer', 'user_direct',
]
async function pinModels(userId, model) {
  const modelMap = Object.fromEntries(AGENT_ROLES.map((r) => [r, model]))
  const patched = await serviceRest('PATCH', `user_settings?user_id=eq.${userId}`, { provider: 'openrouter', model_map: modelMap })
  if (!Array.isArray(patched) || patched.length === 0) {
    await serviceRest('POST', 'user_settings', { user_id: userId, provider: 'openrouter', model_map: modelMap })
  }
  const [row] = await serviceRest('GET', `user_settings?user_id=eq.${userId}&select=model_map`)
  if (Object.values(row?.model_map ?? {}).some((m) => m !== model)) throw new Error('model pin failed')
}

const PARTY = [
  { name: 'Bram', abilities: { str: 12, dex: 14, con: 12, int: 14, wis: 14, cha: 10 }, skills: ['investigation', 'perception', 'insight'] },
  { name: 'Kestrel', abilities: { str: 10, dex: 16, con: 12, int: 12, wis: 10, cha: 16 }, skills: ['persuasion', 'stealth', 'acrobatics'] },
  { name: 'Dain', abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 14, cha: 8 }, skills: ['athletics', 'insight', 'survival'] },
]

export async function executeRun(run) {
  const config = { ...DEFAULTS, ...(run.config ?? {}) }
  const logPath = `tests/lab/logs/${run.id}.jsonl`
  const { log, timed, flush } = createRunLogger(run.id, logPath)
  await serviceRest('PATCH', `lab_runs?id=eq.${run.id}`, {
    status: 'running', started_at: new Date().toISOString(), log_path: logPath,
  })
  const rng = seededRng(run.id)
  const playerSpend = { usd: 0, tokens: 0 }
  let advId = null

  const spentUsd = async () => {
    if (!advId) return playerSpend.usd
    const rows = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=cost_usd`)
    return rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0) + playerSpend.usd
  }
  const cancelled = async () => {
    const [row] = await serviceRest('GET', `lab_runs?id=eq.${run.id}&select=status`)
    return row?.status === 'cancelled'
  }

  try {
    // ---- Setup: users, characters, model pin ----
    const stamp = Date.now()
    const password = `Lab-password-${stamp}!`
    const partySize = Math.min(Math.max(Number(config.party_size) || 1, 1), PARTY.length)
    const members = []
    await timed('setup', 'auth.create_users', `${partySize} player(s)`, async () => {
      // Unique per ATTEMPT, not per run: re-executing a run whose first attempt died mid-flight
      // (process teardown) collided on the email and 422'd the whole rerun (2026-07-23).
      const attempt = Date.now().toString(36)
      for (let i = 0; i < partySize; i++) {
        const email = `lab-${run.id.slice(0, 8)}-${attempt}-p${i + 1}@example.com`
        const userId = await createConfirmedUser(email, password)
        const token = await signIn(email, password)
        members.push({ userId, token, ...PARTY[i] })
      }
      await pinModels(members[0].userId, config.model)
      return { logDetail: { emails: members.length, model: config.model } }
    })

    // ---- Adventure: fresh generation or reuse of a prior lab guide ----
    if (config.adventure_id) {
      advId = config.adventure_id
      await serviceRest('PATCH', `adventures?id=eq.${advId}`, { creator_id: members[0].userId })
      log('setup', 'adventure.reuse', advId, { note: 'existing lab adventure reassigned to this run' })
    } else {
      const [adventure] = await serviceRest('POST', 'adventures', {
        creator_id: members[0].userId, mode: 'full_ai',
        min_players: 1, max_players: partySize, type: config.type,
        status: 'draft', demo: false,
        title: config.plot?.title ?? 'Lab adventure', plot_idea: config.plot?.idea ?? '',
      })
      advId = adventure.id
      log('setup', 'adventure.create', `${config.plot?.title ?? 'untitled'} (${config.type})`, { adventure_id: advId })
    }
    await serviceRest('PATCH', `lab_runs?id=eq.${run.id}`, { adventure_id: advId })

    // ---- Guide generation (skipped on reuse) ----
    if (!config.adventure_id) {
      const started = await pipeline(members[0].token, { action: 'start', adventure_id: advId })
      if (started.status !== 202) throw new Error(`pipeline start failed: ${JSON.stringify(started)}`)
      log('guide', 'pipeline.start', '', {})
      let status = 'generating'
      let retries = 0
      let fingerprint = ''
      let stallPolls = 0
      let lastDone = -1
      for (let i = 0; i < 400 && status === 'generating'; i++) {
        await sleep(4000)
        if (await cancelled()) throw new Error('cancelled by user')
        const [row] = await serviceRest('GET', `adventures?id=eq.${advId}&select=status`)
        status = row.status
        const jobs = await serviceRest('GET', `guide_jobs?adventure_id=eq.${advId}&select=id,stage,status,error&order=stage`)
        const failed = jobs.find((j) => j.status === 'failed')
        if (failed) {
          if (retries >= 4) throw new Error(`stage ${failed.stage} failed ${retries}x: ${failed.error}`)
          retries++
          log('guide', 'pipeline.retry', `stage ${failed.stage}`, { error: String(failed.error).slice(0, 200), attempt: retries })
          await pipeline(members[0].token, { action: 'retry', job_id: failed.id })
          status = 'generating'
          continue
        }
        // The server's kick is fire-and-forget; the client is the safety net on a lost kick.
        const next = jobs.map((j) => `${j.id}:${j.status}`).join('|')
        const hasPending = jobs.some((j) => j.status === 'queued' || j.status === 'running')
        if (hasPending && next === fingerprint) {
          if (++stallPolls >= 4) {
            stallPolls = 0
            log('guide', 'pipeline.nudge', 'stalled - re-kicking runner', {})
            await pipeline(members[0].token, { action: 'run', adventure_id: advId })
          }
        } else stallPolls = 0
        fingerprint = next
        const done = jobs.filter((j) => j.status === 'done').length
        if (done !== lastDone) {
          lastDone = done
          log('guide', 'pipeline.progress', `${done}/${jobs.length} stages done`, { spent_usd: await spentUsd() })
        }
      }
      if (status !== 'guide_ready') throw new Error(`guide never became ready (${status})`)
    }

    // What the pipeline authored - the page shows this while play spins up.
    const [chapters, objectives, endings, npcs, locations, warnings] = await Promise.all([
      serviceRest('GET', `chapters?adventure_id=eq.${advId}&select=index,title&order=index`),
      serviceRest('GET', `objectives?adventure_id=eq.${advId}&select=title,reveal_state,completion_predicates&order=index`),
      serviceRest('GET', `endings?adventure_id=eq.${advId}&select=title,tone`),
      serviceRest('GET', `npcs?adventure_id=eq.${advId}&select=name`),
      serviceRest('GET', `locations?adventure_id=eq.${advId}&select=name`),
      serviceRest('GET', `guide_warnings?adventure_id=eq.${advId}&select=stage,kind,message`),
    ])
    log('guide', 'guide.authored', `${chapters.length} chapters, ${objectives.length} objectives, ${npcs.length} npcs`, {
      chapters, objectives: objectives.map((o) => o.title), endings, locations: locations.map((l) => l.name), warnings,
    })

    // ---- Lobby -> session ----
    for (const m of members) {
      const [char] = await serviceRest('POST', 'characters', {
        user_id: m.userId, name: m.name, level: 1, is_complete: true,
        abilities: m.abilities, skill_proficiencies: m.skills, hp_max: 11, hp_current: 11,
      })
      m.charId = char.id
    }
    await act(members[0].token, { action: 'activate', adventure_id: advId })
    if (members.length > 1) {
      const [{ invite_code }] = await serviceRest('GET', `adventures?id=eq.${advId}&select=invite_code`)
      for (const m of members.slice(1)) await act(m.token, { action: 'join', invite_code })
    }
    for (const m of members) {
      await act(m.token, { action: 'pick_character', adventure_id: advId, character_id: m.charId })
      await act(m.token, { action: 'ready', adventure_id: advId, ready: true })
    }
    const startedSession = await act(members[0].token, { action: 'start_session', adventure_id: advId })
    log('play', 'session.start', startedSession.status === 200 ? 'session started' : `status ${startedSession.status}`,
      { status: startedSession.status, body: startedSession.body })

    // Progress Director threshold overrides. Reaching the rescue rungs at production settings
    // takes 9-15 stalled turns per objective; a test run lowers them so rung 4/5 behaviour can
    // be observed in a handful of turns without waiting out the real ladder.
    if (config.director_thresholds) {
      const applied = await act(members[0].token, {
        action: 'player_intent', adventure_id: advId, kind: 'dm_command', command: 'set_auto',
        director_thresholds: config.director_thresholds,
      })
      log('play', 'session.set_director_thresholds',
        applied.status === 200 ? JSON.stringify(config.director_thresholds) : `status ${applied.status}`,
        { status: applied.status, body: applied.body })
    }

    // ---- Play loop ----
    let lastEventId = 0
    const mirrorGameEvents = async () => {
      const rows = await serviceRest('GET',
        `event_log?adventure_id=eq.${advId}&id=gt.${lastEventId}&select=id,type,payload&order=id`)
      for (const e of rows) {
        lastEventId = e.id
        log('play', `game.${e.type}`, String(e.payload?.title ?? e.payload?.label ?? e.payload?.text ?? '').slice(0, 120),
          { event_log_id: e.id, payload: e.payload })
      }
      return rows
    }
    await mirrorGameEvents()

    const turnStats = []
    let climaxMode = false // set once autocomplete hands the finale to natural play
    for (let turn = 1; turn <= Number(config.turns); turn++) {
      const spent = await spentUsd()
      if (spent > Number(config.budget_usd)) {
        log('play', 'budget.guard', `stopped at $${spent.toFixed(4)} after ${turn - 1} turns`, { spent_usd: spent })
        break
      }
      if (await cancelled()) { log('play', 'run.cancelled', `at turn ${turn}`, {}); break }

      // Ending-test mode: drive objectives UP TO the finale so the run reaches its climax and
      // ending instead of stalling on the pacing wall - then stop, and let the climax beat and
      // its boss fight play naturally (climaxMode). Off by default; set autocomplete_objectives.
      if (config.autocomplete_objectives && !climaxMode && turn % Number(config.autocomplete_every ?? 2) === 0) {
        const driven = await completeActiveObjective({ act, serviceRest, token: members[0].token, advId, log })
          .catch((err) => { log('autocomplete', 'objective.failed', String(err?.message ?? err), {}); return null })
        if (driven?.climax) climaxMode = true
      }

      // Fail fast on a dead spine. Run e7711f6e spent 100 turns and 33 minutes after the story
      // engine had already failed on turn 9 - every turn past that was a scripted player talking
      // to a world that could not advance. The same invariants that judge the finished run are
      // worth asking periodically, because "a quest was accepted and no beat ever opened" is
      // just as true (and just as fatal) at turn 20 as at turn 100.
      if (turn > 1 && turn % PREFLIGHT_EVERY === 1 && !config.autocomplete_objectives) {
        const soFar = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&select=type`)
        const counts = {}
        soFar.forEach((e) => { counts[e.type] = (counts[e.type] ?? 0) + 1 })
        // members[0], not `actor` - that is declared further down this loop body, so reaching
        // for it here is a temporal-dead-zone crash on the first checkpoint turn. Caught by the
        // 20-turn smoke this ladder exists to run first, instead of 30 minutes into the long one.
        const mid = (await act(members[0].token, { action: 'resync', adventure_id: advId })).body.state
        const health = checkInvariants({
          eventCounts: counts, state: mid, turnStats,
          incidents: (await serviceRest('GET',
            `event_log?adventure_id=eq.${advId}&select=payload&type=eq.incident`)).map((e) => e.payload),
        })
        for (const w of health.warnings ?? []) log('play', 'invariant.warning', w, { at_turn: turn })
        if (!health.ok) {
          for (const v of health.violations) log('play', 'invariant.VIOLATED', v, { at_turn: turn })
          log('play', 'run.aborted', `dead spine at turn ${turn} - not spending the rest of the budget`, {
            violations: health.violations,
          })
          break
        }
      }

      // Stop when the STORY ends, not only when the turn budget does. Until now a run was a
      // fixed-length sample of an adventure's opening; with a long budget we can finally watch
      // one all the way to its ending and see whether it commits one at all.
      const [committed] = await serviceRest(
        'GET', `event_log?adventure_id=eq.${advId}&type=eq.ending_committed&select=payload&limit=1`)
      if (committed) {
        log('play', 'run.ending_committed',
          `story finished after ${turn - 1} turns: ${committed.payload?.title ?? 'an ending'}`,
          { ending: committed.payload })
        break
      }

      const actor = members[(turn - 1) % members.length]
      const state = (await act(actor.token, { action: 'resync', adventure_id: advId })).body.state
      const lines = state?.dialogue?.lines ?? []
      const offer = state?.objectives?.offers?.[0]?.label ?? null

      const quality = pickQuality(config.quality, rng)
      const player = await timed('play', 'player_agent.generate', `${actor.name} (${quality})`, async () => {
        const out = await generatePlayerTurn({
          model: config.model, quality, characterName: actor.name, lines, pendingOffer: offer,
        })
        playerSpend.usd += out.costUsd
        playerSpend.tokens += out.tokens
        return { ...out, logDetail: { quality, text: out.text, tokens: out.tokens } }
      })

      const res = await timed('play', 'session.player_intent', `turn ${turn}: "${player.text}"`, async () => {
        const r = await act(actor.token, { action: 'player_intent', adventure_id: advId, kind: 'say', text: player.text })
        return { ...r, logDetail: { resolved: r.body?.resolved ?? r.body?.error ?? r.status, status: r.status } }
      })

      // Pending prompts must be answered or the next turn 409s. Assists claimed by a second
      // PC when there is one; group checks rolled by everyone; solo checks by their owner.
      // Whatever happens, the loop must NEVER hand the next turn a live prompt - run 01075d91
      // carried one for twelve consecutive 409'd turns.
      for (let i = 0; i < 4; i++) {
        const mid = (await act(actor.token, { action: 'resync', adventure_id: advId })).body.state
        const pending = mid?.dialogue?.pending
        if (!pending?.id) break
        let answered = false
        if (pending.kind === 'assist' && members.length > 1) {
          // Assist prompts name their actor `primaryCharacterId` - there is no actorCharacterId
          // on them. Reading the wrong field made every member "differ" from undefined, so
          // find() picked members[0]... who WAS the primary, and the claim 403'd ("You cannot
          // assist your own attempt") three times in a row while the prompt sat pending.
          const primaryId = pending.primaryCharacterId ?? pending.actorCharacterId
          const helper = members.find((m) => m.charId !== primaryId) ?? actor
          const res = await timed('play', 'session.claim_assist', helper.name, () =>
            act(helper.token, { action: 'claim_assist', adventure_id: advId, prompt_id: pending.id }))
          answered = res.status === 200
        } else if (pending.kind === 'group') {
          for (const m of members) {
            await timed('play', 'session.roll_pending', `${m.name} (group)`, () =>
              act(m.token, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id }))
          }
          answered = true // the next iteration's resync verifies
        } else {
          const owner = members.find((m) => m.charId === pending.actorCharacterId) ?? actor
          const res = await timed('play', 'session.roll_pending', owner.name, () =>
            act(owner.token, { action: 'roll_pending', adventure_id: advId, prompt_id: pending.id }))
          answered = res.status === 200
        }
        if (!answered) {
          // The proper answer was refused (or the prompt is a kind this loop does not know).
          // Wait out the prompt's own 15-20s deadline and sweep: resolve_pending auto-rolls
          // idle players flat and fails an unclaimed enable-assist forward.
          const wait = Math.max(0, Date.parse(pending.deadline) - Date.now()) + 500
          await sleep(Math.min(wait, 25_000))
          await timed('play', 'session.resolve_pending', `sweep ${pending.kind}`, () =>
            act(actor.token, { action: 'resolve_pending', adventure_id: advId, prompt_id: pending.id }))
        }
      }

      // "Did the turn produce story?" is counted from mirrored narration_published events, NOT
      // a dialogue-length delta: the dialogue buffer caps at 100 lines, so once it slides every
      // turn read as length-unchanged and the last 12 turns of a healthy run reported "silent"
      // (run 6675274d, 2026-07-22).
      const mirrored = await mirrorGameEvents()
      // "Did the player SEE anything?" - narration is not the only way text reaches the table.
      // A turn inside a conversation emits npc_reply instead, so counting narration alone made
      // every dialogue turn read as silent: run 02c5f711 reported 9 silent turns and all 9 had
      // a visible Elara Vance line. That false alarm cost a full forensic pass to clear.
      // `narrations` stays as-is so the two are still separable.
      turnStats.push({
        turn, quality, text: player.text,
        resolved: res.body?.resolved ?? res.status,
        status: res.status,
        narrations: mirrored.filter((e) => e.type === 'narration_published').length,
        replies: mirrored.filter((e) => e.type === 'npc_reply').length,
      })
    }

    // ---- Analysis ----
    const events = await serviceRest('GET', `event_log?adventure_id=eq.${advId}&select=id,type,payload&order=id`)
    const state = (await act(members[0].token, { action: 'resync', adventure_id: advId })).body.state
    const lines = state?.dialogue?.lines ?? []
    const byType = {}
    events.forEach((e) => { byType[e.type] = (byType[e.type] ?? 0) + 1 })
    const usage = await serviceRest('GET', `usage_log?adventure_id=eq.${advId}&select=agent_role,cost_usd`)
    const byRole = {}
    usage.forEach((u) => {
      byRole[u.agent_role] = byRole[u.agent_role] ?? { calls: 0, cost: 0 }
      byRole[u.agent_role].calls++
      byRole[u.agent_role].cost += Number(u.cost_usd) || 0
    })
    const totalSpend = await spentUsd()
    const summary = {
      plot: config.plot ?? null,
      type: config.type,
      party_size: partySize,
      quality: config.quality,
      turns_played: turnStats.length,
      turns_errored: turnStats.filter((t) => t.status !== 200).length,
      // Silent = the player saw NOTHING. A dialogue turn is not silent.
      turns_silent: turnStats
        .filter((t) => t.narrations === 0 && (t.replies ?? 0) === 0)
        .map((t) => ({ turn: t.turn, text: t.text })),
      turns_dialogue_only: turnStats.filter((t) => t.narrations === 0 && (t.replies ?? 0) > 0).length,
      fallback_lines: lines.filter((l) => l.text === FALLBACK).length,
      incidents: events.filter((e) => e.type === 'incident').map((e) => e.payload),
      objectives_completed: byType.objective_completed ?? 0,
      beats_opened: byType.beat_opened ?? 0,
      encounters: { opened: byType.encounter_opened ?? 0, resolved: byType.encounter_resolved ?? 0 },
      idle_nudges: byType.idle_nudge ?? 0,
      event_counts: byType,
      spend: { total_usd: totalSpend, player_agent_usd: playerSpend.usd, by_role: byRole },
      transcript: lines.map((l) => ({ speaker: l.speaker ?? null, text: l.text })),
      turn_stats: turnStats,
    }
    // Did the engine engage at all? A violated invariant makes every other number in this
    // summary meaningless, so it is computed before anything is reported and shouted about.
    summary.invariants = checkInvariants({
      eventCounts: byType, state, turnStats, incidents: summary.incidents,
    })
    writeFileSync(`tests/lab/logs/${run.id}.summary.json`, JSON.stringify(summary, null, 2))
    for (const w of summary.invariants.warnings ?? []) log('analysis', 'invariant.warning', w, {})
    if (!summary.invariants.ok) {
      for (const v of summary.invariants.violations) {
        log('analysis', 'invariant.VIOLATED', v, {})
      }
    }
    log('analysis', 'run.summary',
      `${turnStats.length} turns, ${summary.objectives_completed} objectives, $${totalSpend.toFixed(4)}` +
        (summary.invariants.ok ? '' : ` - ${summary.invariants.violations.length} INVARIANT VIOLATION(S)`),
      { ...summary, transcript: undefined, turn_stats: undefined, event_counts: undefined })

    await flush()
    await serviceRest('PATCH', `lab_runs?id=eq.${run.id}`, {
      status: 'done', finished_at: new Date().toISOString(), spent_usd: totalSpend, summary,
    })
    return summary
  } catch (err) {
    log('analysis', 'run.failed', String(err?.message ?? err).slice(0, 300), {})
    await flush().catch(() => {})
    await serviceRest('PATCH', `lab_runs?id=eq.${run.id}`, {
      status: (await cancelled().catch(() => false)) ? 'cancelled' : 'failed',
      finished_at: new Date().toISOString(),
      spent_usd: await spentUsd().catch(() => 0),
      error: String(err?.message ?? err).slice(0, 500),
    }).catch(() => {})
    throw err
  }
}
