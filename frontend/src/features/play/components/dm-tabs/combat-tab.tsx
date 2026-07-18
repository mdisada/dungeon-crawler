import type { CombatState } from '@rules/state'

/**
 * F06 SS5 Combat tab. Phase 4 renders the authoritative view read-only; initiative reorder,
 * difficulty slider, add-combatant, and HP/condition edits land with the Combat Engine (F09,
 * Phase 7) and orchestrator actions (Phase 5).
 */
export function DmCombatTab({ combat }: { combat: CombatState }) {
  const byId = new Map(combat.tokens.map((t) => [t.id, t]))
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="text-xs text-muted-foreground">Round {combat.round}</p>
      <ol className="flex flex-col gap-1" aria-label="Initiative order">
        {combat.initiative.map(({ tokenId, roll }) => {
          const token = byId.get(tokenId)
          if (!token) return null
          return (
            <li
              key={tokenId}
              className={`flex items-center justify-between rounded border px-2 py-1 ${
                tokenId === combat.activeTokenId ? 'border-primary' : 'border-transparent'
              }`}
            >
              <span>
                {token.name}
                <span className="ml-1 text-xs text-muted-foreground">({token.allegiance})</span>
              </span>
              <span className="text-xs text-muted-foreground">
                init {roll}
                {token.hp ? ` · ${token.hp.current}/${token.hp.max} HP` : ''}
                {token.conditions.length > 0 ? ` · ${token.conditions.join(', ')}` : ''}
              </span>
            </li>
          )
        })}
      </ol>
      <p className="text-xs text-muted-foreground">
        Reorder, difficulty, add-combatant, and quick edits arrive with the Combat Engine (Phase 7).
      </p>
    </div>
  )
}
