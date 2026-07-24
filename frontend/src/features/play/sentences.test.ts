import { describe, expect, it } from 'vitest'

import { splitSentences } from './sentences'

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
