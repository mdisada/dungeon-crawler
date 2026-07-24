import { cn } from '@/lib/utils'
import type { CombatEngineState } from '@rules/combat'

import { quantizedHpFraction } from '../redaction'

interface InitiativeRailProps {
  engine: CombatEngineState
  selectedId: string | null
  onSelect: (id: string) => void
}

/** Top-center turn tracker: round, act order left-to-right, active enlarged, HP + conditions. */
export function InitiativeRail({ engine, selectedId, onSelect }: InitiativeRailProps) {
  const byId = new Map(engine.combatants.map((c) => [c.id, c]))
  const activeId = engine.status === 'active' ? engine.initiative[engine.turnIndex].id : null

  return (
    <div className="flex items-center gap-2 rounded-full border border-border bg-background/90 px-3 py-1.5 shadow-lg backdrop-blur">
      <span className="text-xs font-semibold text-muted-foreground">
        {engine.status === 'ended' ? `${engine.winner} wins` : `Round ${engine.round}`}
      </span>
      <ol className="flex items-end gap-1.5" aria-label="Initiative order">
        {engine.initiative.map(({ id, total }) => {
          const c = byId.get(id)
          if (!c) return null
          const down = c.dead || c.conditions.includes('unconscious')
          const fraction = c.side === 'party'
            ? c.hp.current / Math.max(1, c.hp.max)
            : quantizedHpFraction(c.hp.current, c.hp.max)
          const isActive = id === activeId
          return (
            <li key={id}>
              <button
                type="button"
                title={`${c.name} - initiative ${total}`}
                aria-label={`${c.name}, initiative ${total}${isActive ? ', active turn' : ''}${down ? ', down' : ''}`}
                onClick={() => onSelect(id)}
                className={cn('group relative flex flex-col items-center', down && 'opacity-40')}
              >
                <span
                  className={cn(
                    'flex items-center justify-center rounded-full border-2 bg-slate-700 font-bold text-white transition-all',
                    c.side === 'party' ? 'border-emerald-400' : 'border-red-500',
                    isActive ? 'h-10 w-10 text-sm shadow-[0_0_10px_2px_rgb(56_189_248/0.7)]' : 'h-7 w-7 text-xs',
                    id === selectedId && 'ring-2 ring-amber-300',
                    c.dead && 'grayscale',
                  )}
                >
                  {c.name.charAt(0)}
                </span>
                <span aria-hidden className="mt-0.5 h-1 w-7 overflow-hidden rounded bg-black/50">
                  <span
                    className={cn('block h-full', c.side === 'party' ? 'bg-emerald-400' : 'bg-red-500')}
                    style={{ width: `${Math.round(fraction * 100)}%` }}
                  />
                </span>
                {c.conditions.length > 0 && (
                  <span
                    title={c.conditions.join(', ')}
                    className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-purple-500 ring-1 ring-white"
                  />
                )}
              </button>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
