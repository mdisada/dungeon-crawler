import { cn } from '@/lib/utils'
import { expectedDamage, formatDiceExpr } from '@rules/combat'
import type { AdvantageReason, AttackSpec, Combatant } from '@rules/combat'

import { hpBandLabel } from '../redaction'

interface ForecastCardProps {
  attack: AttackSpec
  advantage: 'none' | 'advantage' | 'disadvantage'
  reasons: AdvantageReason[]
  target: Combatant
}

/**
 * Pre-attack preview shown on target hover. Player-known facts only: your attack math in full,
 * the enemy reduced to a condition band (no AC, no hit%, no exact HP -- decided 2026-07-22).
 * Party-side targets show exact numbers (your own team is always open information).
 */
export function ForecastCard({ attack, advantage, reasons, target }: ForecastCardProps) {
  const min = attack.damage.count + attack.damage.bonus
  const max = attack.damage.count * attack.damage.sides + attack.damage.bonus
  const avg = expectedDamage(attack.damage)
  const targetLine =
    target.side === 'party'
      ? `AC ${target.ac} - HP ${target.hp.current}/${target.hp.max}${target.hp.temp > 0 ? ` (+${target.hp.temp} temp)` : ''}`
      : hpBandLabel(target.hp.current, target.hp.max)

  return (
    <div className="w-56 rounded-lg border border-border bg-background/95 p-2 text-xs shadow-xl">
      <p className="font-semibold">
        {attack.name} <span className="text-muted-foreground">+{attack.toHit} to hit</span>
      </p>
      <p className="text-muted-foreground">
        {formatDiceExpr(attack.damage)} -- dmg {Math.max(0, min)} / {avg} / {Math.max(0, max)}
      </p>
      {reasons.length > 0 && (
        <ul className="mt-1 flex flex-wrap gap-1">
          {reasons.map((r) => (
            <li
              key={r.label}
              className={cn(
                'rounded-full px-1.5 py-0.5 font-medium',
                r.dir === 'adv' ? 'bg-emerald-500/15 text-emerald-500' : 'bg-destructive/15 text-destructive',
              )}
            >
              {r.dir === 'adv' ? 'ADV' : 'DIS'}: {r.label}
            </li>
          ))}
        </ul>
      )}
      {advantage === 'none' && reasons.length > 1 && (
        <p className="mt-0.5 text-muted-foreground">advantage and disadvantage cancel out</p>
      )}
      <p className="mt-1 border-t border-border pt-1">
        <span className="font-semibold">{target.name}</span>{' '}
        <span className="text-muted-foreground">{targetLine}</span>
        {target.conditions.length > 0 && (
          <span className="text-purple-400"> - {target.conditions.join(', ')}</span>
        )}
      </p>
    </div>
  )
}
