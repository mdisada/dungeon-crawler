// Player-facing enemy redaction (decided 2026-07-22): players never see exact enemy numbers.
// Enemy HP renders as a quarter-quantized bar + a 5e-flavored band label; AC, exact HP, and
// attack lists stay hidden. Party info is always exact (it's the player's own team). The DM
// surface (left sidebar editor) is unredacted.

export function quantizedHpFraction(current: number, max: number): number {
  if (current <= 0) return 0
  return Math.ceil((current / Math.max(1, max)) * 4) / 4
}

export function hpBandLabel(current: number, max: number): string {
  if (current <= 0) return 'down'
  const fraction = current / Math.max(1, max)
  if (fraction >= 1) return 'unharmed'
  if (fraction > 0.5) return 'injured'
  if (fraction > 0.25) return 'bloodied'
  return 'near death'
}
