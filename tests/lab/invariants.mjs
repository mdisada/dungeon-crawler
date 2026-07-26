// Post-run invariant checks: did the STORY ENGINE actually engage?
//
// Written after run e7711f6e burned 100 turns and 33 minutes producing zero objectives. A
// missing import made acceptOffer throw halfway: the database recorded the quest as accepted
// while game state never cleared the offer banner, so the Director spent 91 turns pressing an
// offer nobody could answer. Every existing check passed - the functions booted, 578 unit tests
// were green, and the $0 suite's 130 assertions all held, because its fixture contract has no
// deadline and never reached the broken line.
//
// The gap those checks share is that they all test COMPONENTS. Nothing asserted the one thing
// that matters end to end: that accepting a quest leads to a beat, a beat leads to a milestone,
// and a milestone leads to an objective. These are the cheap questions worth asking after every
// run, and the reason to ask them is that a violated one makes the rest of the run meaningless.

/**
 * @param {object} ctx
 * @param {Record<string, number>} ctx.eventCounts
 * @param {object} ctx.state          final game state
 * @param {Array} ctx.turnStats
 * @param {Array} ctx.incidents
 * @param {Array} [ctx.resolutions]   encounter_resolved payloads - drives the graph-health checks
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkInvariants({ eventCounts, state, turnStats, incidents, resolutions = [] }) {
  const violations = []
  // Split by what the finding MEANS, not by how alarming it sounds. `fatal` means the story
  // engine cannot advance, so every further turn is wasted money - abort. `warnings` are real
  // defects worth reporting that do not stop the run.
  //
  // The distinction cost a run to learn: three HTTP 500s in 75 turns tripped the abort at turn
  // 76 of 100 while the story was plainly alive (9 beats, 13 milestones, 77 narrations). The
  // detection was right and the response was wrong, which is the same mistake the consistency
  // checker made all week - a guard whose false stops cost more than the thing it prevents.
  const warnings = []
  const count = (type) => eventCounts[type] ?? 0
  const offers = state?.objectives?.offers ?? []
  const quests = state?.objectives?.quests ?? []

  // THE one that caught nothing tonight. A half-applied acceptance leaves the database and the
  // game state disagreeing, and every downstream system trusts the game state.
  if (count('offer_accepted') > 0 && offers.length > 0) {
    violations.push(
      `an offer was accepted but ${offers.length} offer banner(s) are still showing - ` +
      `acceptance did not reach game state (the shape of run e7711f6e)`)
  }
  if (count('offer_accepted') > 0 && quests.length === 0) {
    violations.push('an offer was accepted but the quest journal is empty')
  }

  // The spine, in order. Each of these is "the story never started" wearing a different hat.
  if (count('offer_accepted') > 0 && count('beat_opened') === 0) {
    violations.push('a quest was accepted but no beat ever opened - the loop never ran')
  }
  if (count('beat_opened') > 0 && count('milestone_reached') === 0 && turnStats.length >= 20) {
    violations.push(`${count('beat_opened')} beat(s) opened but no milestone was ever reached`)
  }
  if (turnStats.length >= 40 && count('objective_completed') === 0) {
    violations.push(`${turnStats.length} turns and not one objective completed`)
  }

  // The Director burning its terminal rung against a wall. Repeated identical failures are the
  // signature of a system retrying something that cannot succeed.
  const forceFailures = incidents.filter((i) => i?.kind === 'offer_force_failed').length
  if (forceFailures >= 3) {
    violations.push(`offer_force_failed fired ${forceFailures}x - the director is forcing an offer that cannot be forced`)
  }

  // Players being refused. Real, and worth reporting - but a scatter of them is a flaky agent
  // call, not a dead engine. Only a table that is refusing EVERYTHING has stopped being a game.
  const rejected = turnStats.filter((t) => t.status !== 200).length
  const rejectRate = turnStats.length > 0 ? rejected / turnStats.length : 0
  if (rejected > 0) warnings.push(`${rejected}/${turnStats.length} turns were rejected by the API`)
  if (turnStats.length >= 10 && rejectRate >= 0.5) {
    violations.push(`${rejected}/${turnStats.length} turns rejected - the table is locked`)
  }

  // Nothing the player could read.
  const blind = turnStats.filter((t) => (t.narrations ?? 0) === 0 && (t.replies ?? 0) === 0).length
  if (blind >= 5) warnings.push(`${blind} turns produced neither narration nor dialogue`)
  if (turnStats.length >= 20 && blind >= turnStats.length * 0.5) {
    violations.push(`${blind}/${turnStats.length} turns produced nothing the player could read`)
  }

  // --- authored-graph health (added 2026-07-27) --------------------------------------------
  //
  // Run 9ed8729b reported quality "good" and 3 objectives completed while the spine was not
  // working at all: three of five encounter resolutions credited nothing, both remaining
  // objectives were finished by the recognition judge rather than by an authored outcome map, and
  // one objective re-arrived at the same dead end three times. Every check above passed, because
  // they all ask "did SOMETHING happen" and the safety nets guaranteed that something did.
  //
  // These three ask the sharper question: did the story advance the way it was authored to, or
  // did the fallbacks carry it? A run the safety nets rescued is not a passing run - it is a
  // failing run with the evidence hidden.
  const barren = resolutions.filter((r) => (r?.milestones ?? []).length === 0).length
  if (resolutions.length >= 4 && barren >= Math.ceil(resolutions.length * 0.5)) {
    violations.push(
      `${barren}/${resolutions.length} encounter resolutions credited no milestone - the outcome ` +
      'maps are not what is moving the story')
  }

  // The recognition judge exists to catch what the deterministic path missed. When it is
  // completing MORE objectives than the outcome maps are, it has stopped being a safety net.
  const recognized = count('objective_recognized')
  const completed = count('objective_completed')
  if (completed > 0 && recognized >= completed) {
    warnings.push(
      `${recognized} objective(s) credited by the recognition judge vs ${completed} completed - ` +
      'the safety net is doing the spine\'s job')
  }

  // The navigator arriving at the same non-decision over and over. Whatever the reason, a party
  // that keeps being told "nothing to open" is a party standing still.
  if (count('graph_navigation_exhausted') >= 3) {
    violations.push(
      `the navigator found nothing to open ${count('graph_navigation_exhausted')}x - the authored ` +
      'graph is running dry mid-objective')
  }

  // `graph_navigation_stopped` is the HEALTHY stop: an authored success edge saying "the objective
  // resolves here". One per objective is normal. Many more than that means a node keeps reporting
  // the objective finished while the objective stays open - the party arrives at the same
  // non-decision repeatedly, which is precisely how the null-target dead end presented before it
  // was diagnosed (six stops, three objectives, one of them hit three times).
  // One stop per objective is the healthy shape; one spare absorbs a legitimate retry.
  const stopped = count('graph_navigation_stopped')
  if (stopped >= 3 && stopped > completed + 1) {
    violations.push(
      `${stopped} navigation stops against ${completed} completed objective(s) - a node keeps ` +
      'reporting its objective resolved while the objective stays open')
  }

  return { ok: violations.length === 0, violations, warnings }
}
