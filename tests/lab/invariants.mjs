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
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkInvariants({ eventCounts, state, turnStats, incidents }) {
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

  return { ok: violations.length === 0, violations, warnings }
}
