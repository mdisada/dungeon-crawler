import { describe, expect, it } from 'vitest'

import { locationImageSubject, stripNames } from './location-prompt'

describe('stripNames', () => {
  it('removes a name and the possessive with it', () => {
    expect(stripNames("Maren's cottage at dusk", ['Maren'])).toBe('cottage at dusk')
  })

  it('removes a multi-word name and its parts', () => {
    expect(stripNames('the shrine where Elder Maren waits, and Maren keeps her ledger', ['Elder Maren'])).toBe(
      'the shrine where waits, and keeps her ledger',
    )
  })

  it('leaves lowercase words that happen to match a short name', () => {
    // An NPC called "Ash" must not turn "ash-covered rooftops" into "-covered rooftops".
    expect(stripNames('ash-covered rooftops under a grey sky', ['Ash'])).toBe(
      'ash-covered rooftops under a grey sky',
    )
  })

  it('does not strip tokens shorter than the collision threshold', () => {
    expect(stripNames('the Vex quarter', ['Vex Thornwood'])).toBe('the Vex quarter')
    expect(stripNames('Vex Thornwood keeps the gate', ['Vex Thornwood'])).toBe('keeps the gate')
  })

  it('tidies the punctuation a removal leaves behind', () => {
    expect(stripNames('a hall, Volgarth, and a throne', ['Volgarth'])).toBe('a hall, and a throne')
    expect(stripNames('Volgarth, a ruined keep', ['Volgarth'])).toBe('a ruined keep')
  })

  it('is a no-op when no name appears', () => {
    expect(stripNames('a windswept moor', ['Maren', 'Volgarth'])).toBe('a windswept moor')
  })
})

describe('locationImageSubject', () => {
  const location = {
    name: 'The Drowned Quarter',
    imagePrompt: "Maren's harbour at dusk, half-sunken warehouses and rope bridges",
    description: 'A flooded dockside district of half-sunken warehouses.',
  }

  it('prefers the authored image prompt, with the cast removed', () => {
    expect(locationImageSubject(location, ['Maren'])).toBe(
      'harbour at dusk, half-sunken warehouses and rope bridges',
    )
  })

  it('strips the location name too, so the plate carries no lettering cue', () => {
    const named = { ...location, imagePrompt: 'The Drowned Quarter at low tide, fog on the cobbles' }
    expect(locationImageSubject(named, [])).toBe('at low tide, fog on the cobbles')
  })

  it('falls back to the description when the prompt was mostly names', () => {
    const thin = { ...location, imagePrompt: "Maren's" }
    expect(locationImageSubject(thin, ['Maren'])).toBe('A flooded dockside district of half-sunken warehouses.')
  })

  it('returns nothing when there is nothing to draw', () => {
    expect(locationImageSubject({ name: 'Nowhere', imagePrompt: '', description: '' }, [])).toBe('')
  })
})
