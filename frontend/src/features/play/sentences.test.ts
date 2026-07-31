import { describe, expect, it } from 'vitest'

import { chunkSentences, splitSentences } from './sentences'

describe('splitSentences', () => {
  it('keeps a closing quote with the sentence it ends', () => {
    const text = 'The elder leans in. "They took the miller’s boy." Silence follows.'
    expect(splitSentences(text)).toEqual([
      'The elder leans in. ',
      '"They took the miller’s boy." ',
      'Silence follows.',
    ])
  })

  it('does not split inside a decimal', () => {
    expect(splitSentences('The drop is 3.5 metres. Mind your step.')).toEqual([
      'The drop is 3.5 metres. ',
      'Mind your step.',
    ])
  })

  it('treats an ellipsis or a run of stops as one break', () => {
    expect(splitSentences('You hesitate... The door waits.')).toEqual(['You hesitate... ', 'The door waits.'])
  })

  it('returns one piece when there is nothing to split', () => {
    expect(splitSentences('A door, unbarred')).toEqual(['A door, unbarred'])
    expect(splitSentences('')).toEqual([])
  })

  it('rejoins into the original text', () => {
    const text = '"Run!" she shouts. Torchlight gutters; the stair falls away into dark. Go.'
    expect(splitSentences(text).join('')).toBe(text)
  })
})

describe('chunkSentences', () => {
  it('packs whole sentences up to the budget', () => {
    const text = 'One two three. Four five six. Seven eight nine.'
    // 30 fits the first two sentences (29 chars trimmed) but not the third.
    expect(chunkSentences(text, 30)).toEqual(['One two three. Four five six. ', 'Seven eight nine.'])
  })

  it('never cuts a sentence that is longer than the budget', () => {
    const long = 'The corridor runs on further than the torchlight reaches.'
    expect(chunkSentences(`Short one. ${long} After.`, 20)).toEqual(['Short one. ', `${long} `, 'After.'])
  })

  it('trailing whitespace does not push a sentence into the next chunk', () => {
    // "Ten chars. " is 11 with the space, 10 trimmed - so the budget of 10 still holds it alone.
    expect(chunkSentences('Ten chars. Next.', 10)).toEqual(['Ten chars. ', 'Next.'])
  })

  it('rejoins into the original text', () => {
    const text = 'Dusk settles. The bell has not rung in three days. Nobody says why. You knock.'
    expect(chunkSentences(text, 25).join('')).toBe(text)
    expect(chunkSentences('', 25)).toEqual([])
  })
})
