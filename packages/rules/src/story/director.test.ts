import { describe, expect, it } from 'vitest'

import {
  advanceDirectorState, decideDirector, DEFAULT_DIRECTOR_THRESHOLDS, EMPTY_DIRECTOR_STATE,
  worstCaseTurnsPerObjective,
} from './director'
import type { DirectorInput, DirectorState } from './director'

const base = (over: Partial<DirectorInput> = {}): DirectorInput => ({
  state: EMPTY_DIRECTOR_STATE,
  thresholds: DEFAULT_DIRECTOR_THRESHOLDS,
  routeHealth: 'healthy',
  hasOpenEncounter: false,
  hasPendingOffer: false,
  hasActiveObjective: true,
  guaranteedRouteAvailable: false,
  failForwardAllowed: false,
  ...over,
})
const at = (turns: number, over: Partial<DirectorState> = {}): DirectorState => ({
  ...EMPTY_DIRECTOR_STATE, turnsSinceProgress: turns, ...over,
})

describe('advanceDirectorState', () => {
  it('counts only real turns', () => {
    const s = advanceDirectorState(EMPTY_DIRECTOR_STATE, { countsAsTurn: false, progressed: false, objectiveChanged: false, offerPending: false })
    expect(s.turnsSinceProgress).toBe(0)
  })
  it('progress resets the streak and the ladder', () => {
    const stuck = at(7, { rung: 3, lastRungTurn: 6 })
    const s = advanceDirectorState(stuck, { countsAsTurn: true, progressed: true, objectiveChanged: false, offerPending: false })
    expect(s.turnsSinceProgress).toBe(0)
    expect(s.rung).toBe(0)
  })
  it('a new objective resets its own counter but keeps the ladder honest', () => {
    const s = advanceDirectorState(at(3, { turnsOnObjective: 9 }), { countsAsTurn: true, progressed: true, objectiveChanged: true, offerPending: false })
    expect(s.turnsOnObjective).toBe(0)
  })
  it('offer counter clears the moment the offer is answered', () => {
    const s = advanceDirectorState(at(2, { offerPendingTurns: 5 }), { countsAsTurn: true, progressed: false, objectiveChanged: false, offerPending: false })
    expect(s.offerPendingTurns).toBe(0)
  })
  it('offer counter accumulates while it stands', () => {
    const s = advanceDirectorState(at(2, { offerPendingTurns: 5 }), { countsAsTurn: true, progressed: false, objectiveChanged: false, offerPending: true })
    expect(s.offerPendingTurns).toBe(6)
  })
})

describe('decideDirector - the ladder', () => {
  it('says nothing while the party is moving', () => {
    expect(decideDirector(base()).action).toBe('none')
    expect(decideDirector(base({ state: at(1) })).action).toBe('none')
  })

  it('climbs one rung at a time, never repeating without progress', () => {
    expect(decideDirector(base({ state: at(2) })).action).toBe('nudge')
    // Same streak, rung already delivered -> hold.
    expect(decideDirector(base({ state: at(3, { rung: 1 }) })).action).toBe('none')
    expect(decideDirector(base({ state: at(4, { rung: 1 }) })).action).toBe('reveal')
    expect(decideDirector(base({ state: at(6, { rung: 2 }) })).action).toBe('replan_beat')
  })

  it('never regresses to a lower rung - it climbs or holds', () => {
    // With a rescue available it climbs past 3...
    expect(decideDirector(base({ state: at(20, { rung: 3 }), guaranteedRouteAvailable: true })).rung)
      .toBeGreaterThan(3)
    // ...and with nothing above it available, it holds rather than re-delivering rung 1-3.
    expect(decideDirector(base({ state: at(20, { rung: 3 }) })).action).toBe('none')
  })

  it('skips rescue rungs that cannot execute (Phase 4 gates)', () => {
    // Past every threshold, but neither rescue is wired yet.
    expect(decideDirector(base({ state: at(30, { rung: 3 }) })).action).toBe('none')
    expect(decideDirector(base({ state: at(30, { rung: 3 }), guaranteedRouteAvailable: true })).action)
      .toBe('guaranteed_route')
    expect(decideDirector(base({ state: at(30, { rung: 4 }), failForwardAllowed: true })).action)
      .toBe('fail_forward')
  })

  it('holds the gentle rungs while an encounter is open, but not the rescues', () => {
    expect(decideDirector(base({ state: at(5), hasOpenEncounter: true })).action).toBe('none')
    expect(decideDirector(base({ state: at(20), hasOpenEncounter: true, guaranteedRouteAvailable: true })).action)
      .toBe('guaranteed_route')
  })

  it('an encounter that has stalled past the replan threshold stops shielding itself', () => {
    // The total blackout (live 2026-07-23, The Long Road to Emberfall): three guards all keyed
    // on "an encounter is open" - this floor, rung 4's own !state.encounter, and route health
    // reporting 'healthy' forever while a conversation stays open. 9 no-progress turns inside
    // one social encounter and the ladder fired ZERO times.
    const stalled = base({ state: at(6), hasOpenEncounter: true, guaranteedRouteAvailable: false })
    expect(decideDirector(stalled).action).toBe('replan_beat')
  })

  it('but a young encounter still gets its grace - a table mid-scene is not stalled', () => {
    for (const turns of [1, 3, 5]) {
      expect(decideDirector(base({ state: at(turns), hasOpenEncounter: true })).action).toBe('none')
    }
  })

  it('re-planning against an open encounter still does not repeat itself', () => {
    const alreadyReplanned = base({ state: at(8, { rung: 3 }), hasOpenEncounter: true })
    expect(decideDirector(alreadyReplanned).action).toBe('none')
  })

  it('a party ignoring an open rescue reaches fail_forward, not another rescue', () => {
    // The infinite-rescue loop (live 2026-07-23): opening a rescue logs encounter_opened, which
    // is progress, which resets the ladder - so an ignored rescue would re-open forever and
    // rung 5 could never fire. The caller withholds guaranteedRouteAvailable while an encounter
    // is open; with the floor at rung 4 that leaves exactly one legal move.
    const ignoring = base({
      state: at(20), hasOpenEncounter: true,
      guaranteedRouteAvailable: false, failForwardAllowed: true,
    })
    expect(decideDirector(ignoring).action).toBe('fail_forward')
  })

  it('the objective ladder is bounded even against a total refusal to engage', () => {
    // Walk the whole ladder as a stalling party would, asserting it terminates.
    let state = EMPTY_DIRECTOR_STATE
    let encounterOpen = false
    const seen: string[] = []
    for (let turn = 0; turn < 40; turn++) {
      const decision = decideDirector(base({
        state, hasOpenEncounter: encounterOpen,
        guaranteedRouteAvailable: !encounterOpen, failForwardAllowed: true,
      }))
      if (decision.action !== 'none') {
        seen.push(decision.action)
        if (decision.action === 'fail_forward') break
        // A rescue opens an encounter, which is "progress" - the ladder resets.
        if (decision.action === 'guaranteed_route') {
          encounterOpen = true
          state = advanceDirectorState(state, { countsAsTurn: true, progressed: true, objectiveChanged: false, offerPending: false })
          continue
        }
        state = { ...state, rung: Math.max(state.rung, decision.rung), lastRungTurn: state.turnsSinceProgress }
      }
      state = advanceDirectorState(state, { countsAsTurn: true, progressed: false, objectiveChanged: false, offerPending: false })
    }
    expect(seen).toContain('guaranteed_route')
    expect(seen[seen.length - 1]).toBe('fail_forward')
  })

  it('a broken route re-plans immediately instead of hinting at nothing', () => {
    // The Sunken Chapel failure: hinting at a beat that can never open is useless.
    expect(decideDirector(base({ state: at(0), routeHealth: 'stillborn' })).action).toBe('replan_beat')
    expect(decideDirector(base({ state: at(0), routeHealth: 'missing' })).action).toBe('replan_beat')
  })

  it('a stillborn route does not re-plan twice in a row', () => {
    expect(decideDirector(base({ state: at(2, { rung: 3 }), routeHealth: 'stillborn' })).action).toBe('none')
  })

  it('a spent beat gets one turn of grace, then re-plans', () => {
    expect(decideDirector(base({ state: at(0), routeHealth: 'spent' })).action).toBe('none')
    expect(decideDirector(base({ state: at(1), routeHealth: 'spent' })).action).toBe('replan_beat')
  })

  it('does nothing without an active objective (nothing to escalate toward)', () => {
    expect(decideDirector(base({ state: at(30), hasActiveObjective: false })).action).toBe('none')
  })
})

describe('decideDirector - offer pressure', () => {
  it('presses an un-answered offer and outranks the objective ladder', () => {
    // The 35-of-50-turn failure: no ladder rung can help before the story is accepted, so
    // on a pressing turn the offer wins even though the objective ladder is deep into rung 3.
    const d = decideDirector(base({ state: at(9, { offerPendingTurns: 3 }), hasPendingOffer: true }))
    expect(d.action).toBe('offer_pressure')
  })
  it('stays quiet before the threshold', () => {
    expect(decideDirector(base({ state: at(2, { offerPendingTurns: 1 }), hasPendingOffer: true })).action)
      .not.toBe('offer_pressure')
  })
  it('backs off instead of pressing every turn (the 3-in-a-row live defect)', () => {
    const press = (n: number) =>
      decideDirector(base({ state: at(n, { offerPendingTurns: n }), hasPendingOffer: true })).action
    expect(press(3)).toBe('offer_pressure')
    expect(press(4)).toBe('none')
    expect(press(5)).toBe('none')
    expect(press(6)).toBe('none')
    expect(press(7)).toBe('offer_pressure')
  })
  it('an unanswered offer never falls through to the objective ladder', () => {
    // Nothing on the ladder can help before the story is accepted.
    expect(decideDirector(base({ state: at(12, { offerPendingTurns: 12 }), hasPendingOffer: true })).action)
      .toBe('none')
  })

  it('stops asking after MAX presses and starts the story (the 30-turn passive failure)', () => {
    const press = (n: number) => decideDirector(base({
      state: at(n, { offerPendingTurns: n }), hasPendingOffer: true, failForwardAllowed: true,
    })).action
    expect(press(3)).toBe('offer_pressure')   // press 1
    expect(press(7)).toBe('offer_pressure')   // press 2
    expect(press(11)).toBe('offer_pressure')  // press 3
    expect(press(15)).toBe('offer_forced')    // enough - events overtake them
    expect(press(19)).toBe('offer_forced')
  })

  it('never forces the hook in assist - that is the human DM\'s call', () => {
    const action = decideDirector(base({
      state: at(19, { offerPendingTurns: 19 }), hasPendingOffer: true, failForwardAllowed: false,
    })).action
    expect(action).toBe('offer_pressure')
  })

  it('the offer ladder is bounded - it always reaches a terminal step', () => {
    // The property the 30-turn run violated: pressure must not be able to repeat forever.
    const actions = Array.from({ length: 40 }, (_, n) => decideDirector(base({
      state: at(n, { offerPendingTurns: n }), hasPendingOffer: true, failForwardAllowed: true,
    })).action)
    expect(actions).toContain('offer_forced')
    expect(actions.indexOf('offer_forced')).toBeLessThan(20)
  })
})

describe('jitter (telegraph, do not schedule)', () => {
  it('shifts thresholds by at most one turn either way', () => {
    expect(decideDirector(base({ state: at(1), jitter: -1 })).action).toBe('nudge')
    expect(decideDirector(base({ state: at(2), jitter: 1 })).action).toBe('none')
    expect(decideDirector(base({ state: at(3), jitter: 1 })).action).toBe('nudge')
  })
  it('is clamped - a wild value cannot disable the ladder', () => {
    expect(decideDirector(base({ state: at(3), jitter: 99 })).action).toBe('nudge')
  })
})

describe('bounded story', () => {
  it('an objective retires within the exported bound', () => {
    expect(worstCaseTurnsPerObjective()).toBe(41)
    const t = DEFAULT_DIRECTOR_THRESHOLDS
    expect(t.nudge).toBeLessThan(t.reveal)
    expect(t.reveal).toBeLessThan(t.replanBeat)
    expect(t.replanBeat).toBeLessThan(t.guaranteedRoute)
    expect(t.guaranteedRoute).toBeLessThan(t.failForward)
    expect(t.guaranteedRouteOnObjective).toBeLessThan(t.failForwardOnObjective)
  })

  it('THE churn case: an objective bogged down but never quiet still gets retired', () => {
    // The Tidewater Vault, 100 turns (live 2026-07-23): "Secure the Conscripts Manifest" held
    // the story for 40 turns. Six failed encounters kept awarding milestones, so
    // turnsSinceProgress never reached 9 and the rescue rungs were unreachable. The old bound
    // of failForward+1 was not a bound at all - it assumed silence the party never produced.
    let state = EMPTY_DIRECTOR_STATE
    const seen = []
    for (let turn = 0; turn < 60; turn++) {
      const decision = decideDirector(base({
        state, guaranteedRouteAvailable: true, failForwardAllowed: true,
      }))
      if (decision.action !== 'none') {
        seen.push({ turn, action: decision.action, reason: decision.reason })
        if (decision.action === 'fail_forward') break
        state = { ...state, rung: Math.max(state.rung, decision.rung), lastRungTurn: state.turnsSinceProgress }
      }
      // Something small happens every other turn - a failed encounter still credits a milestone -
      // so the silence clock keeps resetting and only the objective clock advances.
      state = advanceDirectorState(state, {
        countsAsTurn: true, progressed: turn % 2 === 0, objectiveChanged: false, offerPending: false,
      })
    }
    expect(seen.some((s) => s.action === 'guaranteed_route')).toBe(true)
    expect(seen[seen.length - 1].action).toBe('fail_forward')
    expect(seen[seen.length - 1].reason).toContain('turns on this objective')
    expect(seen[seen.length - 1].turn).toBeLessThanOrEqual(worstCaseTurnsPerObjective())
  })

  it('but a healthy objective never trips the objective clock', () => {
    // Objectives 0 and 1 of that same run completed in roughly 20 and 30 turns. The rescue
    // thresholds sit above that on purpose: firing on a working objective would read as the
    // game giving up on a party that is doing fine.
    const healthy = at(1, { turnsOnObjective: 22 })
    expect(decideDirector(base({
      state: healthy, guaranteedRouteAvailable: true, failForwardAllowed: true,
    })).action).toBe('none')
  })
})

describe('the objective clock measures ONE objective', () => {
  it('resets when the story moves to the next objective', () => {
    const spent = at(2, { turnsOnObjective: 38 })
    const s = advanceDirectorState(spent, {
      countsAsTurn: true, progressed: true, objectiveChanged: true, offerPending: false,
    })
    expect(s.turnsOnObjective).toBe(0)
  })

  it('a fresh objective does not inherit the previous one spent clock', () => {
    // Without the reset, objective 2 would arrive with 38 turns already on the meter and trip
    // a rescue on its very first turn.
    const fresh = advanceDirectorState(at(2, { turnsOnObjective: 38 }), {
      countsAsTurn: true, progressed: true, objectiveChanged: true, offerPending: false,
    })
    expect(decideDirector(base({
      state: fresh, guaranteedRouteAvailable: true, failForwardAllowed: true,
    })).action).toBe('none')
  })

  it('keeps counting while the objective holds', () => {
    const s = advanceDirectorState(at(1, { turnsOnObjective: 10 }), {
      countsAsTurn: true, progressed: false, objectiveChanged: false, offerPending: false,
    })
    expect(s.turnsOnObjective).toBe(11)
  })
})
