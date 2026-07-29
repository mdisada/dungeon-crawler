import { describe, expect, it } from 'vitest'

import { trimToCompleteSentence } from './truncation'

describe('trimToCompleteSentence', () => {
  it('leaves a complete narration alone', () => {
    const text = 'The skiff groans under four bodies but holds. Sella points to a stilted shack.'
    expect(trimToCompleteSentence(text)).toEqual({ text, trimmed: false })
  })

  it('accepts a closing quote after the full stop', () => {
    const text = 'He looks up. "That book stays where it is."'
    expect(trimToCompleteSentence(text).trimmed).toBe(false)
  })

  it('cuts back the real truncation a player was shown (run bac9f4b9 #15)', () => {
    const text = 'The obsidian shard feels unnaturally cold in your palm, its surface reflecting the '
      + 'dim light. As you turn it over, the thrum of machinery intensifies. The secrets'
    const out = trimToCompleteSentence(text)
    expect(out.trimmed).toBe(true)
    expect(out.text.endsWith('intensifies.')).toBe(true)
    expect(out.text).not.toContain('The secrets')
  })

  it('keeps the original rather than cut away most of the paragraph', () => {
    // A blank or one-clause turn is worse than a ragged tail - nine swallowed player actions is
    // what that failure mode already cost.
    const text = 'He nods. Then the whole of the rest of this paragraph runs on and on without ever'
    expect(trimToCompleteSentence(text)).toEqual({ text, trimmed: false })
  })

  it('is safe on empty input', () => {
    expect(trimToCompleteSentence('')).toEqual({ text: '', trimmed: false })
  })
})
