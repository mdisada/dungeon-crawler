import { expectedDamage, formatDiceExpr } from '@rules/combat'
import type { Combatant, SpellSpec } from '@rules/combat'

import { hpBandLabel } from '../redaction'

/**
 * Single-target spell preview on hover. Player-facing: shows only your own spell math (attack
 * bonus or your save DC + the target's save ability), never the enemy's AC, HP, or save mod.
 * A save-based spell is honest 5e - you know the DC, not whether they'll make it.
 */
export function SpellForecastCard({ spell, target }: { spell: SpellSpec; target: Combatant }) {
  const min = spell.amount.count + spell.amount.bonus
  const max = spell.amount.count * spell.amount.sides + spell.amount.bonus
  const avg = expectedDamage(spell.amount)
  const targetLine =
    target.side === 'party'
      ? `AC ${target.ac} - HP ${target.hp.current}/${target.hp.max}`
      : hpBandLabel(target.hp.current, target.hp.max)

  return (
    <div className="w-56 rounded-lg border border-border bg-background/95 p-2 text-xs shadow-xl">
      <p className="font-semibold">{spell.name}</p>
      {spell.effect === 'attack' && (
        <p className="text-muted-foreground">+{spell.toHit ?? 0} spell attack vs AC</p>
      )}
      {spell.effect === 'save' && (
        <p className="text-muted-foreground">
          {(spell.saveAbility ?? 'dex').toUpperCase()} save vs DC {spell.saveDc ?? 10}
          {spell.onSave === 'half' ? ' (half on save)' : ' (none on save)'}
        </p>
      )}
      <p className="text-muted-foreground">
        {spell.effect === 'heal' ? 'heal' : 'dmg'} {formatDiceExpr(spell.amount)} = {Math.max(0, min)} / {avg} /{' '}
        {Math.max(0, max)}
      </p>
      <p className="mt-1 border-t border-border pt-1">
        <span className="font-semibold">{target.name}</span>{' '}
        <span className="text-muted-foreground">{targetLine}</span>
      </p>
    </div>
  )
}
