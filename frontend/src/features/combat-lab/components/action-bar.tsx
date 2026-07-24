import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { activeCombatant, chebyshev, formatDiceExpr } from '@rules/combat'
import type { CombatAction, CombatEngineState } from '@rules/combat'

export interface PendingMove {
  to: [number, number]
  path: [number, number][]
  cost: number
  provokes: { id: string; name: string }[]
  /** Non-null = illegal preview; Confirm disabled and this string shown. */
  reason: string | null
}

export interface CastingState {
  spellIndex: number
  spellName: string
  mode: 'single' | 'aoe'
  /** AoE only: whether an aim is placed and legal, plus the confirm blocker/affected list. */
  aimPlaced: boolean
  aimReason: string | null
  affected: string[]
}

interface ActionBarProps {
  engine: CombatEngineState
  targetingAttack: number | null
  pendingMove: PendingMove | null
  casting: CastingState | null
  onPickAttack: (index: number | null) => void
  onPickSpell: (index: number | null) => void
  onAct: (action: CombatAction) => void
  onConfirmMove: () => void
  onCancelMove: () => void
  onConfirmCast: () => void
  onPlayAiTurn: () => void
}

function EconomyPill({ label, ready, detail }: { label: string; ready: boolean; detail?: string }) {
  return (
    <span
      title={ready ? `${label} available` : `${label} already used`}
      className={cn(
        'rounded-full px-2.5 py-0.5 text-xs font-medium',
        ready ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground line-through opacity-60',
      )}
    >
      {label}
      {detail && <span className="ml-1 font-semibold no-underline">{detail}</span>}
    </span>
  )
}

/** Bottom action bar: whose turn, 5e economy as web pills, gated verbs, attack submenu. */
export function ActionBar({
  engine, targetingAttack, pendingMove, casting, onPickAttack, onPickSpell, onAct,
  onConfirmMove, onCancelMove, onConfirmCast, onPlayAiTurn,
}: ActionBarProps) {
  const [attackMenuOpen, setAttackMenuOpen] = useState(false)
  const [spellMenuOpen, setSpellMenuOpen] = useState(false)

  if (engine.status === 'ended') {
    return (
      <div className="rounded-xl border border-border bg-background/95 px-4 py-2 text-sm font-semibold shadow-xl">
        Combat over -- {engine.winner} wins
      </div>
    )
  }

  const active = activeCombatant(engine)
  const { economy } = engine

  if (active.auto) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/95 px-4 py-2 shadow-xl">
        <span className="flex items-center gap-2 text-sm">
          <span aria-hidden className={cn('h-2 w-2 rounded-full', active.side === 'party' ? 'bg-emerald-400' : 'bg-red-500')} />
          {active.name} <span className="text-muted-foreground">(AI controlled)</span>
        </span>
        <Button size="sm" onClick={onPlayAiTurn}>Play turn</Button>
      </div>
    )
  }

  // Attack gating: nearest living opponent vs each attack's max reach, with an actionable hint.
  const targets = engine.combatants.filter((c) => c.side !== active.side && !c.dead)
  const nearest = targets.length > 0 ? Math.min(...targets.map((t) => chebyshev(active, t))) : null
  const attackReason = (attack: (typeof active.attacks)[number]): string | null => {
    if (!economy.action) return 'Action already used'
    if (nearest === null) return 'No targets left'
    const reach = attack.longRange ?? attack.range
    if (nearest <= reach) return null
    const gap = nearest - reach
    return gap <= economy.move ? `Out of range -- move ${gap} sq closer` : 'No target reachable this turn'
  }
  const actionReason = economy.action ? null : 'Action already used'
  const standCost = Math.ceil(active.speed / 2)
  const prone = active.conditions.includes('prone')

  // Spell gating: budget by cost, and (single-target) a legal target within range.
  const spellReason = (spell: (typeof active.spells)[number]): string | null => {
    const budget = spell.cost === 'bonus' ? economy.bonus : economy.action
    if (!budget) return spell.cost === 'bonus' ? 'No bonus action left' : 'Action already used'
    if (spell.area.shape === 'single') {
      const wantAlly = (spell.affects ?? (spell.effect === 'heal' ? 'allies' : 'enemies')) === 'allies'
      const pool = engine.combatants.filter(
        (c) => !c.dead && (wantAlly ? c.side === active.side : c.side !== active.side),
      )
      const closest = pool.length > 0 ? Math.min(...pool.map((t) => chebyshev(active, t))) : null
      if (closest === null) return wantAlly ? 'No allies in play' : 'No targets left'
      if (closest > spell.range) {
        const gap = closest - spell.range
        return gap <= economy.move ? `Out of range -- move ${gap} sq closer` : 'No target in range'
      }
    }
    return null
  }

  function pickAttack(index: number) {
    setAttackMenuOpen(false)
    setSpellMenuOpen(false)
    onPickAttack(index)
  }

  function pickSpell(index: number) {
    setAttackMenuOpen(false)
    setSpellMenuOpen(false)
    onPickSpell(index)
  }

  function act(action: CombatAction) {
    setAttackMenuOpen(false)
    setSpellMenuOpen(false)
    onAct(action)
  }

  return (
    <div className="relative flex flex-col items-center gap-1.5">
      {attackMenuOpen && (
        <ul className="w-72 rounded-lg border border-border bg-background/95 p-1 shadow-xl" aria-label="Choose an attack">
          {active.attacks.map((attack, i) => {
            const reason = attackReason(attack)
            const rangeText = attack.longRange ? `r${attack.range}/${attack.longRange}` : `r${attack.range}`
            return (
              <li key={`${attack.name}-${i}`}>
                <button
                  type="button"
                  disabled={reason !== null}
                  title={reason ?? `Attack with ${attack.name}`}
                  aria-label={`${attack.name}${reason ? `. ${reason}` : ''}`}
                  onClick={() => pickAttack(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                    reason ? 'cursor-not-allowed opacity-45' : 'hover:bg-muted',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">{attack.name}</span>
                  <span className="text-xs text-muted-foreground">
                    {attack.kind} +{attack.toHit} {formatDiceExpr(attack.damage)} {rangeText}
                  </span>
                </button>
                {reason && <p className="px-2 pb-1 text-xs text-muted-foreground">{reason}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {spellMenuOpen && active.spells.length > 0 && (
        <ul className="w-72 rounded-lg border border-border bg-background/95 p-1 shadow-xl" aria-label="Choose a spell">
          {active.spells.map((spell, i) => {
            const reason = spellReason(spell)
            const shape = spell.area.shape === 'single' ? '' : ` ${spell.area.shape}`
            const roll =
              spell.effect === 'attack'
                ? `+${spell.toHit ?? 0} atk`
                : spell.effect === 'save'
                  ? `${(spell.saveAbility ?? 'dex').toUpperCase()} DC ${spell.saveDc ?? 10}`
                  : 'heal'
            return (
              <li key={`${spell.name}-${i}`}>
                <button
                  type="button"
                  disabled={reason !== null}
                  title={reason ?? `Cast ${spell.name}`}
                  aria-label={`${spell.name}${reason ? `. ${reason}` : ''}`}
                  onClick={() => pickSpell(i)}
                  className={cn(
                    'flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm',
                    reason ? 'cursor-not-allowed opacity-45' : 'hover:bg-muted',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {spell.name}
                    {spell.cost === 'bonus' && <span className="ml-1 text-xs text-muted-foreground">(bonus)</span>}
                  </span>
                  <span className="text-xs text-muted-foreground">{roll} {formatDiceExpr(spell.amount)}{shape}</span>
                </button>
                {reason && <p className="px-2 pb-1 text-xs text-muted-foreground">{reason}</p>}
              </li>
            )
          })}
        </ul>
      )}

      {targetingAttack !== null && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-400/50 bg-background/95 px-3 py-1.5 text-xs shadow-xl">
          <span>
            Attacking with <span className="font-semibold">{active.attacks[targetingAttack]?.name}</span> -- click a
            highlighted target
          </span>
          <Button variant="outline" size="xs" onClick={() => onPickAttack(null)}>Cancel</Button>
        </div>
      )}

      {casting && casting.mode === 'single' && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-400/50 bg-background/95 px-3 py-1.5 text-xs shadow-xl">
          <span>Casting <span className="font-semibold">{casting.spellName}</span> -- click a highlighted target</span>
          <Button variant="outline" size="xs" onClick={() => onPickSpell(null)}>Cancel</Button>
        </div>
      )}

      {casting && casting.mode === 'aoe' && (
        <div className="flex items-center gap-2 rounded-lg border border-violet-400/50 bg-background/95 px-3 py-1.5 text-xs shadow-xl">
          <span>
            <span className="font-semibold">{casting.spellName}</span>
            {casting.aimPlaced ? (
              <> -- hits {casting.affected.length > 0 ? casting.affected.join(', ') : 'no one'}</>
            ) : (
              <> -- click the map to aim</>
            )}
            {casting.aimReason && <span className="font-semibold text-destructive"> -- {casting.aimReason}</span>}
          </span>
          <Button size="xs" disabled={!casting.aimPlaced || casting.aimReason !== null} onClick={onConfirmCast}>Confirm</Button>
          <Button variant="outline" size="xs" onClick={() => onPickSpell(null)}>Cancel</Button>
        </div>
      )}

      {pendingMove && (
        <div className="flex items-center gap-2 rounded-lg border border-sky-400/50 bg-background/95 px-3 py-1.5 text-xs shadow-xl">
          <span>
            Move {pendingMove.cost} sq
            {pendingMove.provokes.length > 0 && (
              <span className="font-semibold text-destructive">
                {' '}-- provokes opportunity attack from {pendingMove.provokes.map((p) => p.name).join(', ')}
              </span>
            )}
            {pendingMove.reason && <span className="font-semibold text-destructive"> -- {pendingMove.reason}</span>}
          </span>
          <Button size="xs" disabled={pendingMove.reason !== null} onClick={onConfirmMove}>Confirm</Button>
          <Button variant="outline" size="xs" onClick={onCancelMove}>Cancel</Button>
        </div>
      )}

      <div className="flex items-center gap-3 rounded-xl border border-border bg-background/95 px-3 py-2 shadow-xl">
        <span className="flex items-center gap-2 border-r border-border pr-3 text-sm font-semibold">
          <span aria-hidden className={cn('h-2 w-2 rounded-full', active.side === 'party' ? 'bg-emerald-400' : 'bg-red-500')} />
          {active.name}
        </span>
        <span className="flex items-center gap-1.5 border-r border-border pr-3">
          <EconomyPill label="Action" ready={economy.action} />
          <EconomyPill label="Bonus" ready={economy.bonus} />
          <EconomyPill label="Reaction" ready={active.reactionAvailable} />
          <EconomyPill label="Move" ready={economy.move > 0} detail={`${economy.move} sq`} />
        </span>
        <span className="flex items-center gap-1">
          <Button
            size="sm"
            variant={targetingAttack !== null || attackMenuOpen ? 'default' : 'outline'}
            disabled={actionReason !== null}
            title={actionReason ?? 'Choose an attack'}
            onClick={() => { setAttackMenuOpen((open) => !open); setSpellMenuOpen(false) }}
          >
            Attack
          </Button>
          {active.spells.length > 0 && (
            <Button
              size="sm"
              variant={casting !== null || spellMenuOpen ? 'default' : 'outline'}
              title="Cast a spell"
              onClick={() => { setSpellMenuOpen((open) => !open); setAttackMenuOpen(false) }}
            >
              Cast
            </Button>
          )}
          <Button size="sm" variant="outline" disabled={actionReason !== null} title={actionReason ?? 'Action: +speed movement'} onClick={() => act({ type: 'dash' })}>
            Dash
          </Button>
          <Button size="sm" variant="outline" disabled={actionReason !== null} title={actionReason ?? 'Action: attackers have disadvantage until your next turn'} onClick={() => act({ type: 'dodge' })}>
            Dodge
          </Button>
          <Button size="sm" variant="outline" disabled={actionReason !== null} title={actionReason ?? 'Action: your movement provokes no opportunity attacks this turn'} onClick={() => act({ type: 'disengage' })}>
            Disengage
          </Button>
          {prone && (
            <Button
              size="sm"
              variant="outline"
              disabled={economy.move < standCost}
              title={economy.move < standCost ? `Not enough movement (needs ${standCost} sq)` : `Spend ${standCost} sq of movement to stand`}
              onClick={() => act({ type: 'stand_up' })}
            >
              Stand up
            </Button>
          )}
          <Button size="sm" onClick={() => act({ type: 'end_turn' })}>End turn</Button>
        </span>
      </div>
    </div>
  )
}
