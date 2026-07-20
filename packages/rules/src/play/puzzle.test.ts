import { describe, expect, it } from 'vitest'

import { newPuzzle, puzzleSolvedTier, recordPuzzleAttempt } from './puzzle.ts'

const seed = () => newPuzzle({ stepsTotal: 3, maxAttempts: 2, activePcIds: ['a', 'b'] })

describe('newPuzzle', () => {
  it('clamps steps and attempts to sane bounds', () => {
    const p = newPuzzle({ stepsTotal: 9, maxAttempts: 0, activePcIds: [] })
    expect(p.stepsTotal).toBe(4)
    expect(p.attemptsLeft).toBe(1)
  })
})

describe('recordPuzzleAttempt', () => {
  it('advancing a step unlocks its hint and tracks contributions', () => {
    const out = recordPuzzleAttempt(seed(), 'a', 'advances_step')
    expect(out.state.stepsDone).toBe(1)
    expect(out.state.hintsUnlocked).toBe(1)
    expect(out.newHintUnlocked).toBe(true)
    expect(out.status).toBe('ongoing')
    expect(out.state.contributions).toEqual({ a: 1 })
  })

  it('a mistaken attempt costs an attempt but unlocks nothing by itself', () => {
    const out = recordPuzzleAttempt(seed(), 'a', 'mistaken')
    expect(out.state.attemptsLeft).toBe(1)
    expect(out.state.hintsUnlocked).toBe(0)
    expect(out.newHintUnlocked).toBe(false)
    expect(out.status).toBe('ongoing')
  })

  it('a DIFFERENT PC taking over unlocks a hint even on a mistake', () => {
    let out = recordPuzzleAttempt(seed(), 'a', 'mistaken')
    out = recordPuzzleAttempt(out.state, 'b', 'mistaken')
    expect(out.state.hintsUnlocked).toBe(1)
    expect(out.newHintUnlocked).toBe(true)
    expect(out.status).toBe('exhausted')
  })

  it('the same PC repeating does not unlock handover hints', () => {
    let out = recordPuzzleAttempt(seed(), 'a', 'advances_step')
    out = recordPuzzleAttempt(out.state, 'a', 'advances_step')
    expect(out.state.hintsUnlocked).toBe(2)
  })

  it('hints never exceed the step count', () => {
    let out = recordPuzzleAttempt(seed(), 'a', 'advances_step')
    out = recordPuzzleAttempt(out.state, 'b', 'advances_step')
    out = recordPuzzleAttempt(out.state, 'a', 'advances_step')
    expect(out.state.hintsUnlocked).toBe(3)
    expect(out.status).toBe('solved')
  })

  it('solves ends the puzzle immediately regardless of steps', () => {
    const out = recordPuzzleAttempt(seed(), 'a', 'solves')
    expect(out.status).toBe('solved')
    expect(out.state.stepsDone).toBe(0)
  })

  it('completing every step solves the puzzle', () => {
    let out = recordPuzzleAttempt(seed(), 'a', 'advances_step')
    out = recordPuzzleAttempt(out.state, 'b', 'advances_step')
    out = recordPuzzleAttempt(out.state, 'a', 'advances_step')
    expect(out.status).toBe('solved')
  })

  it('exhausting attempts fails the puzzle', () => {
    let out = recordPuzzleAttempt(seed(), 'a', 'mistaken')
    out = recordPuzzleAttempt(out.state, 'a', 'mistaken')
    expect(out.status).toBe('exhausted')
    expect(out.state.attemptsLeft).toBe(0)
  })
})

describe('puzzleSolvedTier', () => {
  it('full only with every active PC contributing', () => {
    let out = recordPuzzleAttempt(seed(), 'a', 'advances_step')
    expect(puzzleSolvedTier(out.state)).toBe('partial')
    out = recordPuzzleAttempt(out.state, 'b', 'advances_step')
    expect(puzzleSolvedTier(out.state)).toBe('full')
  })
})
