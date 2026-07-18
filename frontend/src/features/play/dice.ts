// Free dice bar parser/roller for the DM sidebar (F06 SS5). Local-only in Phase 4 - the
// server-side Dice Engine (seeded, logged) arrives with Phase 5; this covers table utility.

export interface DiceRoll {
  expression: string
  rolls: number[]
  modifier: number
  total: number
}

const DICE_RE = /^\s*(\d{0,3})d(\d{1,4})\s*([+-]\s*\d{1,4})?\s*$/i

/** Parses "2d6+3" style expressions; returns null on anything else. */
export function parseDice(expression: string): { count: number; sides: number; modifier: number } | null {
  const match = DICE_RE.exec(expression)
  if (!match) return null
  const count = match[1] === '' ? 1 : Number(match[1])
  const sides = Number(match[2])
  const modifier = match[3] ? Number(match[3].replace(/\s+/g, '')) : 0
  if (count < 1 || count > 100 || sides < 2 || sides > 1000) return null
  return { count, sides, modifier }
}

export function rollDice(expression: string, advantage: 'none' | 'advantage' | 'disadvantage' = 'none'): DiceRoll | null {
  const spec = parseDice(expression)
  if (!spec) return null

  const rollSet = () =>
    Array.from({ length: spec.count }, () => 1 + Math.floor(Math.random() * spec.sides))

  let rolls = rollSet()
  if (advantage !== 'none') {
    const second = rollSet()
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)
    const pickFirst = advantage === 'advantage' ? sum(rolls) >= sum(second) : sum(rolls) <= sum(second)
    rolls = pickFirst ? rolls : second
  }

  return {
    expression,
    rolls,
    modifier: spec.modifier,
    total: rolls.reduce((a, b) => a + b, 0) + spec.modifier,
  }
}
