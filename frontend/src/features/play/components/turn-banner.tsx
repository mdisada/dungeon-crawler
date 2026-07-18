import { cn } from '@/lib/utils'
import type { ActionEconomy, TokenState } from '@rules/state'

interface TurnBannerProps {
  token: TokenState
  economy: ActionEconomy
}

/** "Kaelen's turn" + action economy pips (F06 SS3.1). */
export function TurnBanner({ token, economy }: TurnBannerProps) {
  const pips: { label: string; spent: boolean }[] = [
    { label: 'Action', spent: !economy.action },
    { label: 'Bonus', spent: !economy.bonus },
    { label: `Move ${economy.move}`, spent: economy.move <= 0 },
    { label: 'Reaction', spent: !economy.reaction },
  ]
  return (
    <div className="absolute left-1/2 top-14 z-20 flex -translate-x-1/2 items-center gap-3 rounded-lg bg-black/70 px-4 py-1.5">
      <span className="text-sm font-semibold text-white">{token.name}&rsquo;s turn</span>
      <ul className="flex gap-1.5" aria-label="Action economy">
        {pips.map((pip) => (
          <li
            key={pip.label}
            className={cn(
              'rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide',
              pip.spent ? 'border-white/20 text-white/30 line-through' : 'border-emerald-400/60 text-emerald-200',
            )}
          >
            {pip.label}
          </li>
        ))}
      </ul>
    </div>
  )
}
