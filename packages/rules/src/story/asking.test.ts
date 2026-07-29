import { describe, expect, it } from 'vitest'

import { seeksInformation } from './asking'

// Every string below is a real player reply the entry mapper filed as `fold_in`, taken from the
// six runs audited on 2026-07-29 (tests/lab/entry-audit.mjs). Inventing plausible-looking inputs
// would only test the regexes against themselves.

describe('seeksInformation', () => {
  it('catches questions about the fiction, with or without a question mark', () => {
    for (const text of [
      'who is she',
      'what are the marked entries',
      'What did Maren Thist whisper to Cobb?',
      'What does the wave-glyph signify?',
      'what do they want',
      'What did Edric mean by "She took her pound"?',
      'What were the "stored mouths" in Aaren\'s note?',
      'What did Aaren try to return to Her?',
      'what was on the torn page bram mentioned',
      'what time is it',
    ]) {
      expect(seeksInformation(text), text).toBe(true)
    }
  })

  it('catches examinations - attention pointed at a thing', () => {
    for (const text of [
      'i look around',
      'I look at Cobb.',
      'I examine the boot-heel print.',
      'I look at the Tide-Ledger.',
      'I examine the ring that Edric gave me.',
      'I look at the kelp blocking the passage.',
      'I check on Aaren.',
    ]) {
      expect(seeksInformation(text), text).toBe(true)
    }
  })

  it('refuses "what do I do" - asking the GAME, not the world', () => {
    // There is no object to find a clue on, and a stuck party is the Progress Director's job -
    // its `reveal` rung already exists for exactly this.
    for (const text of ['what do i do', 'what now', 'idk what that means', 'what should i try']) {
      expect(seeksInformation(text), text).toBe(false)
    }
  })

  it('does not mistake "what do THEY want" for the stuck player asking what to do', () => {
    expect(seeksInformation('what do they want')).toBe(true)
    expect(seeksInformation('what do i do')).toBe(false)
  })

  it('refuses replies that act rather than ask', () => {
    for (const text of [
      'I let go of the pages.',
      'I grab the skiff\'s rope and haul it closer.',
      'I shove Rosten Vale aside and grab Selka\'s pen, trying to scrawl my name onto the empty line.',
      'I\'ll take the ledger.',
      'I try to slide the ring onto my ring finger.',
    ]) {
      expect(seeksInformation(text), text).toBe(false)
    }
  })

  it('is safe on empty and whitespace input', () => {
    expect(seeksInformation('')).toBe(false)
    expect(seeksInformation('   ')).toBe(false)
  })
})
