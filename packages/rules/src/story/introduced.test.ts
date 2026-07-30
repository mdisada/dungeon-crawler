import { describe, expect, it } from 'vitest'

import { takeIntroduced } from './introduced'

describe('takeIntroduced', () => {
  it('strips the reporting line and captures what was introduced', () => {
    const out = takeIntroduced(
      'Netta slides a leather case across the desk.\nNEW: a worn leather case; a brass Clean Stamp',
    )
    expect(out.text).toBe('Netta slides a leather case across the desk.')
    expect(out.introduced).toEqual(['a worn leather case', 'a brass Clean Stamp'])
  })

  it('never leaves the label in the player-visible prose', () => {
    for (const raw of ['Prose.\nNEW: a shard', 'Prose.\n  new: a shard  ', 'Prose.\nNEW:a shard']) {
      expect(takeIntroduced(raw).text).not.toMatch(/NEW:/i)
    }
  })

  it('treats "none" as nothing introduced', () => {
    const out = takeIntroduced('The room is as they left it.\nNEW: none')
    expect(out.introduced).toEqual([])
    expect(out.text).toBe('The room is as they left it.')
  })

  it('leaves a narration without the line untouched', () => {
    const text = 'The weighbridge groans. Netta waits.'
    expect(takeIntroduced(text)).toEqual({ text, introduced: [] })
  })

  it('keeps the original rather than publish nothing', () => {
    // A blank turn is worse than an unstripped label - nine swallowed player actions is what that
    // failure mode already cost.
    const out = takeIntroduced('NEW: a shard')
    expect(out.text).toBe('NEW: a shard')
    expect(out.introduced).toEqual([])
  })

  it('is safe on empty input', () => {
    expect(takeIntroduced('')).toEqual({ text: '', introduced: [] })
  })
})
