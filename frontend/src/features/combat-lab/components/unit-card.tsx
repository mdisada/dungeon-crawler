import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { formatDiceExpr } from '@rules/combat'
import type { AttackSpec, CombatSide } from '@rules/combat'

export interface UnitCardView {
  id: string
  name: string
  side: CombatSide
  kind: 'pc' | 'npc'
  /** Enemy cards hide AC, exact HP, and the attack list (decided 2026-07-22). */
  redacted: boolean
  hpLabel: string
  hpFraction: number
  ac: number | null
  speed: number
  conditions: string[]
  flags: string[]
  attacks: AttackSpec[] | null
}

/** On-demand inspection card (token click). Read-only: attacks are launched from the bar. */
export function UnitCard({ view, onClose }: { view: UnitCardView; onClose: () => void }) {
  return (
    <div className="w-64 rounded-lg border border-border bg-background/95 p-3 shadow-xl">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            'flex h-8 w-8 shrink-0 items-center justify-center rounded-full border-2 bg-slate-700 text-sm font-bold text-white',
            view.side === 'party' ? 'border-emerald-400' : 'border-red-500',
          )}
        >
          {view.name.charAt(0)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{view.name}</p>
          <p className="text-xs text-muted-foreground">
            {view.kind === 'pc' ? 'Character' : 'NPC'} - {view.side}
          </p>
        </div>
        <Button variant="ghost" size="icon-xs" aria-label="Close card" onClick={onClose}>
          ✕
        </Button>
      </div>

      <div className="mt-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>HP</span>
          <span>{view.hpLabel}</span>
        </div>
        <div className="h-2 w-full overflow-hidden rounded bg-muted">
          <span
            className={cn('block h-full', view.side === 'party' ? 'bg-emerald-400' : 'bg-red-500')}
            style={{ width: `${Math.round(view.hpFraction * 100)}%` }}
          />
        </div>
      </div>

      <dl className="mt-1.5 flex gap-4 text-xs">
        {view.ac !== null && (
          <div className="flex gap-1"><dt className="text-muted-foreground">AC</dt><dd className="font-medium">{view.ac}</dd></div>
        )}
        <div className="flex gap-1"><dt className="text-muted-foreground">Speed</dt><dd className="font-medium">{view.speed} sq</dd></div>
      </dl>

      {(view.conditions.length > 0 || view.flags.length > 0) && (
        <ul className="mt-1.5 flex flex-wrap gap-1" aria-label="Conditions">
          {[...view.conditions, ...view.flags].map((c) => (
            <li key={c} className="rounded-full bg-purple-500/15 px-2 py-0.5 text-xs text-purple-400">
              {c}
            </li>
          ))}
        </ul>
      )}

      <div className="mt-2 border-t border-border pt-1.5">
        <h3 className="text-xs font-semibold text-muted-foreground">Attacks</h3>
        {view.attacks ? (
          <ul className="mt-1 space-y-1">
            {view.attacks.map((attack, i) => (
              <li key={`${attack.name}-${i}`} className="text-xs">
                <span className="font-medium">{attack.name}</span>{' '}
                <span className="text-muted-foreground">
                  {attack.kind}, +{attack.toHit}, {formatDiceExpr(attack.damage)}, r{attack.range}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-1 text-xs italic text-muted-foreground">Unknown -- watch what it does.</p>
        )}
      </div>
    </div>
  )
}
