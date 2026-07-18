import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

import { rollDice } from '../../dice'
import type { DiceRoll } from '../../dice'

/**
 * F06 SS5 free dice bar. Local rolls only in Phase 4 - the seeded, logged server Dice Engine
 * (and the public/hidden broadcast) arrives with Phase 5.
 */
export function DmDiceTab() {
  const [expression, setExpression] = useState('2d6+3')
  const [advantage, setAdvantage] = useState<'none' | 'advantage' | 'disadvantage'>('none')
  const [rolls, setRolls] = useState<DiceRoll[]>([])
  const [error, setError] = useState<string | null>(null)

  function handleRoll(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    const result = rollDice(expression, advantage)
    if (!result) {
      setError('Use NdM+K, e.g. 2d6+3')
      return
    }
    setError(null)
    setRolls((prev) => [result, ...prev].slice(0, 10))
  }

  return (
    <div className="flex flex-col gap-3 text-sm">
      <form onSubmit={handleRoll} className="flex gap-2">
        <Input
          value={expression}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setExpression(e.target.value)}
          aria-label="Dice expression"
          placeholder="2d6+3"
        />
        <Button type="submit">Roll</Button>
      </form>
      <div className="flex gap-2">
        {(['none', 'advantage', 'disadvantage'] as const).map((mode) => (
          <Button
            key={mode}
            size="sm"
            variant={advantage === mode ? 'default' : 'outline'}
            onClick={() => setAdvantage(mode)}
          >
            {mode === 'none' ? 'Straight' : mode === 'advantage' ? 'Advantage' : 'Disadvantage'}
          </Button>
        ))}
      </div>
      {error && <p className="text-destructive">{error}</p>}
      <ul className="flex flex-col gap-1" aria-label="Recent rolls">
        {rolls.map((roll, i) => (
          <li key={`${roll.expression}-${i}`} className="flex justify-between rounded border px-2 py-1">
            <span className="font-mono text-xs">{roll.expression}</span>
            <span>
              <span className="text-xs text-muted-foreground">[{roll.rolls.join(', ')}]{roll.modifier !== 0 ? ` ${roll.modifier > 0 ? '+' : ''}${roll.modifier}` : ''} = </span>
              <span className="font-semibold">{roll.total}</span>
            </span>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">Rolls are local; public/hidden table rolls arrive with Phase 5.</p>
    </div>
  )
}
