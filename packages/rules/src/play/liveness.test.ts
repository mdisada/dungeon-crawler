import { describe, expect, it } from 'vitest'

import { EVENT_SILENCE_MS, isLogSilent, isTypingStale, TYPING_STALE_MS } from './liveness'

const NOW = new Date('2026-07-27T12:00:00.000Z')
const agoMs = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

describe('isTypingStale', () => {
  it('is false while a turn could still be running', () => {
    expect(isTypingStale(agoMs(1_000), NOW)).toBe(false)
    expect(isTypingStale(agoMs(150_000), NOW)).toBe(false)
  })

  it('is true once no live request could still be behind it', () => {
    expect(isTypingStale(agoMs(TYPING_STALE_MS), NOW)).toBe(true)
    expect(isTypingStale(agoMs(10 * 60_000), NOW)).toBe(true)
  })

  it('leaves the wall-clock margin intact - a 150s turn is never cut off', () => {
    // A turn died at exactly 150_242ms live. Clearing at or below that would let a second turn
    // run concurrently with a first that is still alive.
    expect(TYPING_STALE_MS).toBeGreaterThan(150_242)
    expect(isTypingStale(agoMs(150_242), NOW)).toBe(false)
  })

  it('treats a missing or unparseable stamp as NOT stale', () => {
    // The caller falls back to the event-log rule rather than clearing a turn it knows nothing
    // about. Every session that predates the field lands here.
    expect(isTypingStale(null, NOW)).toBe(false)
    expect(isTypingStale(undefined, NOW)).toBe(false)
    expect(isTypingStale('', NOW)).toBe(false)
    expect(isTypingStale('not a date', NOW)).toBe(false)
  })

  it('is not fooled by a future stamp', () => {
    expect(isTypingStale(new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe(false)
  })

  it('cannot be refreshed by unrelated activity - the whole point of keying on it', () => {
    // The live failure: 22 consecutive turns rejected because background writes kept the event
    // log warm. Whatever else happens, the answer here depends only on when typing was raised.
    const raised = agoMs(10 * 60_000)
    for (let i = 0; i < 22; i++) expect(isTypingStale(raised, NOW)).toBe(true)
  })
})

describe('isLogSilent', () => {
  it('is true only after the full silence window', () => {
    expect(isLogSilent(agoMs(EVENT_SILENCE_MS - 1), NOW)).toBe(false)
    expect(isLogSilent(agoMs(EVENT_SILENCE_MS), NOW)).toBe(true)
  })

  it('treats a missing last event as silent', () => {
    expect(isLogSilent(null, NOW)).toBe(true)
  })
})
