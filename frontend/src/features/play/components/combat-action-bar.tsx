import { Button } from '@/components/ui/button'
import type { CombatState, TurnOptions } from '@rules/state'

import type { CombatActionIntent } from '../api/session'

interface CombatActionBarProps {
  combat: CombatState
  options: TurnOptions
  /** Set while the player is choosing a target on the map. */
  targetingAttack: number | null
  busy: boolean
  onPickAttack: (index: number | null) => void
  onAct: (action: CombatActionIntent) => void
}

/**
 * The controller's turn, at the bottom of the battle map (F09).
 *
 * Everything it offers comes from `combat.options`, computed server-side for the ACTIVE combatant
 * only - so the bar knows this character's own attacks and nothing at all about the enemy's AC,
 * HP or attack list. The Lab's forecast card computes hit chances client-side from full enemy
 * blocks; that is a DM tool, and doing it here would be the redaction leak the shipped rule
 * (2026-07-22) exists to prevent.
 */
export function CombatActionBar({
  combat, options, targetingAttack, busy, onPickAttack, onAct,
}: CombatActionBarProps) {
  const { economy } = combat
  const actionReason = economy.action ? null : 'Action already used'
  const hasTargets = combat.tokens.some((t) => t.allegiance === 'enemy' && (t.hp?.current ?? 1) > 0)

  const attackReason = (): string | null => {
    if (actionReason) return actionReason
    if (!hasTargets) return 'No targets left'
    return null
  }

  return (
    <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 flex-col items-center gap-1.5">
      {targetingAttack !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/60 bg-black/85 px-3 py-1.5 text-xs text-white">
          <span>
            Attacking with{' '}
            <span className="font-semibold">{options.attacks[targetingAttack]?.name ?? 'your weapon'}</span> &mdash;
            click an enemy token
          </span>
          <Button variant="outline" size="xs" onClick={() => onPickAttack(null)}>
            Cancel
          </Button>
        </div>
      )}

      {options.attacks.length > 0 && (
        <ul className="flex flex-wrap justify-center gap-1" aria-label="Your attacks">
          {options.attacks.map((attack) => {
            const reason = attackReason()
            return (
              <li key={attack.index}>
                <Button
                  size="xs"
                  variant={targetingAttack === attack.index ? 'default' : 'outline'}
                  disabled={reason !== null || busy}
                  title={reason ?? `${attack.name}: +${attack.toHit} to hit, ${attack.damage} damage, reach ${attack.range}`}
                  onClick={() => onPickAttack(targetingAttack === attack.index ? null : attack.index)}
                >
                  {attack.name}
                  <span className="ml-1.5 opacity-70">
                    +{attack.toHit} / {attack.damage}
                  </span>
                </Button>
              </li>
            )
          })}
        </ul>
      )}

      <div className="flex items-center gap-1 rounded-xl border border-white/15 bg-black/85 px-2 py-1.5">
        <Button size="xs" variant="outline" disabled={actionReason !== null || busy} title={actionReason ?? 'Action: double your movement'} onClick={() => onAct({ type: 'dash' })}>
          Dash
        </Button>
        <Button size="xs" variant="outline" disabled={actionReason !== null || busy} title={actionReason ?? 'Action: attackers have disadvantage until your next turn'} onClick={() => onAct({ type: 'dodge' })}>
          Dodge
        </Button>
        <Button size="xs" variant="outline" disabled={actionReason !== null || busy} title={actionReason ?? 'Action: moving away provokes nothing this turn'} onClick={() => onAct({ type: 'disengage' })}>
          Disengage
        </Button>
        {options.canStandUp && (
          <Button size="xs" variant="outline" disabled={busy} title={`Spend ${options.standCost} squares of movement to stand`} onClick={() => onAct({ type: 'stand_up' })}>
            Stand up
          </Button>
        )}
        <Button size="xs" disabled={busy} onClick={() => onAct({ type: 'end_turn' })}>
          End turn
        </Button>
      </div>
    </div>
  )
}
