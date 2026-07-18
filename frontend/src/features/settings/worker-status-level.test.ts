import { describe, expect, it } from 'vitest'

import { getWorkerStatusLevel } from './worker-status-level'

describe('getWorkerStatusLevel', () => {
  const now = new Date('2026-07-17T00:00:00Z').getTime()

  it('is red when there has never been a heartbeat', () => {
    expect(getWorkerStatusLevel(null, now)).toBe('red')
  })

  it('is green for a heartbeat under 30s old', () => {
    const at = new Date(now - 10_000).toISOString()
    expect(getWorkerStatusLevel(at, now)).toBe('green')
  })

  it('is yellow for a heartbeat between 30s and 90s old', () => {
    const at = new Date(now - 60_000).toISOString()
    expect(getWorkerStatusLevel(at, now)).toBe('yellow')
  })

  it('is red for a heartbeat older than 90s', () => {
    const at = new Date(now - 120_000).toISOString()
    expect(getWorkerStatusLevel(at, now)).toBe('red')
  })
})
