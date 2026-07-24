import { describe, expect, it } from 'vitest'

import {
  clearDeadline, deadlinePressureLines, dueDeadlines, markMissed, parseDeadlineRecords,
  scheduleDeadline,
} from './deadlines'
import type { DeadlineRecord } from './deadlines'

const escort: DeadlineRecord = {
  contractId: 'c1', label: 'Reach the Assizes', dueDay: 8, giverNpcId: 'n1',
}

describe('scheduleDeadline', () => {
  it('adds a clock', () => {
    expect(scheduleDeadline([], escort)).toEqual([escort])
  })
  it('re-accepting replaces rather than stacks', () => {
    const again = { ...escort, dueDay: 12 }
    expect(scheduleDeadline([escort], again)).toEqual([again])
  })
  it('leaves other contracts alone', () => {
    const other = { ...escort, contractId: 'c2', label: 'Other' }
    expect(scheduleDeadline([other], escort).map((r) => r.contractId).sort()).toEqual(['c1', 'c2'])
  })
})

describe('dueDeadlines - the day must be PAST the due day', () => {
  it('is not due before the day', () => {
    expect(dueDeadlines([escort], 7)).toEqual([])
  })
  it('is not due ON the day - the party still has it to spend', () => {
    expect(dueDeadlines([escort], 8)).toEqual([])
  })
  it('comes due the day after', () => {
    expect(dueDeadlines([escort], 9)).toEqual([escort])
  })
  it('fires once, not every day after', () => {
    const after = markMissed([escort], ['c1'])
    expect(dueDeadlines(after, 20)).toEqual([])
  })
})

describe('clearDeadline', () => {
  it('drops a completed contract clock', () => {
    expect(clearDeadline([escort], 'c1')).toEqual([])
  })
  it('is a no-op for an unknown contract', () => {
    expect(clearDeadline([escort], 'nope')).toEqual([escort])
  })
})

describe('deadlinePressureLines - what the table can feel', () => {
  it('counts down', () => {
    expect(deadlinePressureLines([escort], 5)).toEqual(['Reach the Assizes: 3 days left.'])
  })
  it('uses the singular on the last day but one', () => {
    expect(deadlinePressureLines([escort], 7)).toEqual(['Reach the Assizes: 1 day left.'])
  })
  it('says TODAY on the due day', () => {
    expect(deadlinePressureLines([escort], 8)).toEqual(['Reach the Assizes: TODAY is the last day.'])
  })
  it('goes quiet once the deadline is blown and paid for', () => {
    expect(deadlinePressureLines(markMissed([escort], ['c1']), 9)).toEqual([])
  })
  it('goes quiet once the day is past, even before the miss is marked', () => {
    expect(deadlinePressureLines([escort], 9)).toEqual([])
  })
  it('soonest first', () => {
    const late = { ...escort, contractId: 'c2', label: 'Later', dueDay: 20 }
    expect(deadlinePressureLines([late, escort], 1).map((l) => l.split(':')[0]))
      .toEqual(['Reach the Assizes', 'Later'])
  })
})

describe('parseDeadlineRecords - jsonb round trip', () => {
  it('reads well-formed records', () => {
    expect(parseDeadlineRecords([escort])).toEqual([escort])
  })
  it('preserves the missed flag', () => {
    expect(parseDeadlineRecords([{ ...escort, missed: true }])[0].missed).toBe(true)
  })
  it('drops records with no contract or no day', () => {
    expect(parseDeadlineRecords([{ label: 'x', dueDay: 3 }])).toEqual([])
    expect(parseDeadlineRecords([{ contractId: 'c1' }])).toEqual([])
  })
  it('garbage in, empty out', () => {
    expect(parseDeadlineRecords(null)).toEqual([])
    expect(parseDeadlineRecords('prose')).toEqual([])
    expect(parseDeadlineRecords([null, 42, 'x'])).toEqual([])
  })
})
