import { describe, expect, it } from 'vitest'

import { trailingLabel } from './trailing-label'

describe('trailingLabel', () => {
  const labels = ["Earn Netta Vasch's trust", 'Audit the Vasch Weighbridge']

  it('catches the machine goal pasted on as a closing sentence', () => {
    // Three narrations in run abd318e1 ended exactly like this - with a CURLY apostrophe where the
    // stored label has a straight one, which a literal comparison missed.
    const text = 'You peer closer at the script, but its meaning stays elusive. Earn Netta Vasch’s trust.'
    expect(trailingLabel(text, labels)).toBe("Earn Netta Vasch's trust")
  })

  it('catches an objective title pasted on - the shape run e87b3506 shipped five times', () => {
    const text = "The rope above sways in a draft that shouldn't reach this floor. Learn why the plague bell tolls."
    expect(trailingLabel(text, ['Learn why the plague bell tolls'])).toBe('Learn why the plague bell tolls')
  })

  it('allows a label described legitimately mid-prose', () => {
    const text = 'She wants your help to audit the Vasch Weighbridge, and she is not asking twice.'
    expect(trailingLabel(text, labels)).toBeNull()
  })

  it('cannot see a label woven into mid-paragraph prose - the known cost of that narrowness', () => {
    // Run e87b3506 #74: "The truth in Voss's cellar waits, and Garrett Munn might know the pattern".
    // Documented as a limit, not an aspiration - the upstream fix is the authored diegetic pull.
    const text = "The truth in Voss's cellar waits, and Garrett Munn might know the pattern."
    expect(trailingLabel(text, ["Find the truth in Voss's cellar"])).toBeNull()
  })

  it('ignores labels too short to be distinctive', () => {
    expect(trailingLabel('He waits by the door.', ['door'])).toBeNull()
  })

  it('is safe on empty input', () => {
    expect(trailingLabel('', labels)).toBeNull()
    expect(trailingLabel('Prose.', [])).toBeNull()
  })
})
