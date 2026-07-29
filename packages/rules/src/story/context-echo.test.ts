import { describe, expect, it } from 'vitest'

import { stripContextEcho } from './context-echo'

// The leak below is verbatim from run 5a5e6c7f narration #1 (2026-07-29), the one a player
// actually saw. Inventing a tidier example would only test the regex against itself.
const REAL_LEAK = `You ask Dorya what exactly haunts Mirefleet's waters. Her knuckles whiten as she grips her spyglass.
CAST Dorya Salk - female Mirefleet resident, shopkeeper. // Hessik Var - male Mirefleet resident, harbormaster.
PARTY Bram - human adventurer, level 1. // Kestrel - human adventurer, level 1.
SOFAR Bram and Kestrel arrive in Mirefleet. Dorya Salk offers them a job to investigate the harbour haunting.
LAST Dorya Salk steps closer, her voice raspy as she gestures towards the waterlogged docks.`

describe('stripContextEcho', () => {
  it('removes a wholesale echo of the briefing block, keeping the prose', () => {
    const { text, stripped } = stripContextEcho(REAL_LEAK)
    expect(text).toBe("You ask Dorya what exactly haunts Mirefleet's waters. Her knuckles whiten as she grips her spyglass.")
    expect(stripped).toEqual(['CAST', 'PARTY', 'SOFAR', 'LAST'])
  })

  it('removes a lone unambiguous label - the bare GOAL line a player was shown', () => {
    const { text, stripped } = stripContextEcho('The pressure builds.\nGOAL Uncover the harbour\'s hidden rot')
    expect(text).toBe('The pressure builds.')
    expect(stripped).toEqual(['GOAL'])
  })

  it('keeps a lone LAST or EARLIER - they are ordinary words', () => {
    for (const line of ['EARLIER that evening the tide had turned.', 'LAST light fades from the quay.']) {
      expect(stripContextEcho(line).stripped).toEqual([])
      expect(stripContextEcho(line).text).toBe(line)
    }
  })

  it('strips LAST when it rides with another label - that is the block, not prose', () => {
    const { text, stripped } = stripContextEcho('She turns away.\nCAST Dorya // Hessik\nLAST she turns away.')
    expect(stripped).toEqual(['CAST', 'LAST'])
    expect(text).toBe('She turns away.')
  })

  it('leaves ordinary narration untouched', () => {
    const prose = 'The skiff groans under four bodies but holds.\nSella points to a stilted shack.'
    expect(stripContextEcho(prose)).toEqual({ text: prose, stripped: [] })
  })

  it('does not match lowercase or mid-line occurrences', () => {
    const prose = 'The cast of characters waits. She was last seen at the scene of it.'
    expect(stripContextEcho(prose).stripped).toEqual([])
  })

  it('keeps the original rather than publish nothing', () => {
    // A blank turn is strictly worse than a leaked label - nine silent player actions is what
    // that failure mode already cost (see the entry-echo guard).
    const allLabels = 'CAST Dorya\nPARTY Bram\nSOFAR they arrive'
    expect(stripContextEcho(allLabels).text).toBe(allLabels)
    expect(stripContextEcho(allLabels).stripped).toEqual([])
  })

  it('is safe on empty input', () => {
    expect(stripContextEcho('')).toEqual({ text: '', stripped: [] })
  })
})
