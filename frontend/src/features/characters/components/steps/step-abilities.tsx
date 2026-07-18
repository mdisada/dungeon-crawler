import {
  ABILITY_KEYS,
  abilityModifier,
  POINT_BUY_BUDGET,
  STANDARD_ARRAY,
  validatePointBuy,
  validateStandardArrayAssignment,
  type AbilityKey,
} from '@rules/character'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tabs, TabsList, TabsPanel, TabsTab } from '@/components/ui/tabs'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'

const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

const METHOD_HELP: Record<string, string> = {
  standard_array:
    'The six standard values (15, 14, 13, 12, 10, 8) are pre-assigned below. Pick a value on any ' +
    'ability to swap it with the ability currently holding that value - the set always stays valid.',
  point_buy: 'Spend up to 27 points. Scores range 8-15; higher scores cost more per step.',
  manual: 'Enter any scores 1-20. Not validated - the character sheet will carry an "unbalanced" badge.',
}

function formatModifier(mod: number): string {
  return mod >= 0 ? `+${mod}` : `${mod}`
}

export function StepAbilities({ draft, updateDraft, goNext, goBack }: WizardStepProps) {
  const { abilityMethod, baseAbilities } = draft

  const setAbility = (key: AbilityKey, value: number) => {
    if (abilityMethod === 'standard_array') {
      // Swap: whichever ability currently holds `value` receives this ability's old value, so
      // the assignment stays a valid permutation of the array at all times.
      const holder = ABILITY_KEYS.find((k) => baseAbilities[k] === value)
      const next = { ...baseAbilities, [key]: value }
      if (holder && holder !== key) next[holder] = baseAbilities[key]
      updateDraft({ baseAbilities: next })
      return
    }
    updateDraft({ baseAbilities: { ...baseAbilities, [key]: value } })
  }

  const pointBuyResult = validatePointBuy(baseAbilities)
  const standardArrayValid = validateStandardArrayAssignment(baseAbilities)
  const isValid =
    abilityMethod === 'standard_array'
      ? standardArrayValid
      : abilityMethod === 'point_buy'
        ? pointBuyResult.valid
        : true

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Ability Scores</h2>

      <Tabs
        value={abilityMethod}
        onValueChange={(value) => {
          const method = value as typeof abilityMethod
          const reset =
            method === 'standard_array'
              ? { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 }
              : method === 'point_buy'
                ? { str: 8, dex: 8, con: 8, int: 8, wis: 8, cha: 8 }
                : { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 }
          updateDraft({ abilityMethod: method, baseAbilities: reset })
        }}
      >
        <TabsList>
          <TabsTab value="standard_array">Standard Array</TabsTab>
          <TabsTab value="point_buy">Point Buy</TabsTab>
          <TabsTab value="manual">Manual</TabsTab>
        </TabsList>

        <TabsPanel value={abilityMethod}>
          <p className="mb-3 text-sm text-muted-foreground">{METHOD_HELP[abilityMethod]}</p>
          {abilityMethod === 'point_buy' && (
            <p className="mb-3 text-sm">
              Spent: <span className="font-medium">{pointBuyResult.totalCost}</span> / {POINT_BUY_BUDGET} points
              {!pointBuyResult.valid && pointBuyResult.errors.length > 0 && (
                <span className="ml-2 text-destructive">{pointBuyResult.errors[0]}</span>
              )}
            </p>
          )}
          {abilityMethod === 'manual' && (
            <p className="mb-3 text-sm font-medium text-amber-600">Unbalanced - manual entry is not validated</p>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {ABILITY_KEYS.map((key) => (
              <div key={key} className="rounded-md border p-3">
                <label htmlFor={`ability-${key}`} className="text-sm font-medium">
                  {ABILITY_LABELS[key]}
                </label>
                {abilityMethod === 'standard_array' ? (
                  <Select value={String(baseAbilities[key])} onValueChange={(v) => setAbility(key, Number(v))}>
                    <SelectTrigger id={`ability-${key}`} className="mt-1 w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {STANDARD_ARRAY.map((value) => (
                        <SelectItem key={value} value={String(value)}>
                          {value}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <input
                    id={`ability-${key}`}
                    type="number"
                    min={abilityMethod === 'point_buy' ? 8 : 1}
                    max={abilityMethod === 'point_buy' ? 15 : 20}
                    value={baseAbilities[key]}
                    onChange={(e) => setAbility(key, Number(e.target.value))}
                    className="mt-1 w-full rounded-md border px-2 py-1.5 text-sm"
                  />
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  Modifier: {formatModifier(abilityModifier(baseAbilities[key]))}
                </p>
              </div>
            ))}
          </div>
        </TabsPanel>
      </Tabs>

      <StepNav onBack={goBack} onNext={goNext} nextDisabled={!isValid} />
    </div>
  )
}
