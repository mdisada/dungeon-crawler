import { useState } from 'react'

import {
  abilityModifier,
  applyAbilityBonuses,
  armorClass,
  hitPointsMaxAtLevelOne,
  proficiencyBonus,
  savingThrowModifier,
  SKILL_ABILITY,
  skillModifier,
  type AbilityKey,
} from '@rules/character'
import { timeJob } from '@/lib/job-timer'
import { generateBackgroundNarrative } from '../../api/generate-background-narrative'
import type { WizardStepProps } from '../step-props'
import type { SrdBackground, SrdClass, SrdRace } from '../../types'

export function StepReview({
  draft,
  updateDraft,
  goBack,
  races,
  classes,
  backgrounds,
  onSave,
  isSaving,
}: WizardStepProps & {
  races: SrdRace[]
  classes: SrdClass[]
  backgrounds: SrdBackground[]
  onSave: () => void
  isSaving: boolean
}) {
  const race = races.find((r) => r.key === draft.raceKey)
  const srdClass = classes.find((c) => c.key === draft.classKey)
  const background = backgrounds.find((b) => b.key === draft.backgroundKey)
  const [isGeneratingNarrative, setIsGeneratingNarrative] = useState(false)

  const finalAbilities = applyAbilityBonuses(draft.baseAbilities, draft.abilityBonuses)
  const modifiers = Object.fromEntries(
    (Object.keys(finalAbilities) as AbilityKey[]).map((k) => [k, abilityModifier(finalAbilities[k])]),
  ) as Record<AbilityKey, number>
  const profBonus = proficiencyBonus(1)
  const hpMax = srdClass ? hitPointsMaxAtLevelOne(srdClass.hitDice, modifiers.con) : null
  const ac = armorClass({ dexModifier: modifiers.dex })
  const savingThrowKeys: AbilityKey[] = ['str', 'dex', 'con', 'int', 'wis', 'cha']
  const proficientSaves = new Set(
    (srdClass?.savingThrows ?? []).map((name) => name.slice(0, 3).toLowerCase()) as AbilityKey[],
  )

  async function handleGenerateNarrative() {
    if (!race || !srdClass || !background) return
    setIsGeneratingNarrative(true)
    try {
      const { result } = await timeJob('generate-background-narrative', () =>
        generateBackgroundNarrative({
          raceName: race.name,
          className: srdClass.name,
          backgroundName: background.name,
          freeformText: draft.freeformText,
          physical: draft.physical,
        }),
      )
      updateDraft({ backgroundNarrative: result })
    } finally {
      setIsGeneratingNarrative(false)
    }
  }

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Review &amp; Save</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="rounded-md border p-4 text-sm">
          <p className="font-medium">{draft.name || 'Unnamed character'}</p>
          <p className="text-muted-foreground">
            {race?.name} {srdClass?.name} · {background?.name}
          </p>
          <div className="mt-3 grid grid-cols-3 gap-2">
            <div>
              <p className="text-xs text-muted-foreground">AC</p>
              <p className="font-medium">{ac}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">HP</p>
              <p className="font-medium">{hpMax ?? '—'}</p>
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Prof. Bonus</p>
              <p className="font-medium">+{profBonus}</p>
            </div>
          </div>
        </div>

        <div className="rounded-md border p-4 text-sm">
          <p className="mb-2 font-medium">Saving Throws</p>
          <div className="grid grid-cols-2 gap-1">
            {savingThrowKeys.map((key) => (
              <p key={key}>
                {key.toUpperCase()}: {savingThrowModifier(modifiers[key], proficientSaves.has(key), profBonus) >= 0 ? '+' : ''}
                {savingThrowModifier(modifiers[key], proficientSaves.has(key), profBonus)}
              </p>
            ))}
          </div>
        </div>

        <div className="rounded-md border p-4 text-sm sm:col-span-2">
          <p className="mb-2 font-medium">Skills</p>
          <div className="grid grid-cols-2 gap-1 sm:grid-cols-3">
            {draft.skillProficiencies.map((skill) => {
              const ability = SKILL_ABILITY[skill as keyof typeof SKILL_ABILITY]
              if (!ability) return null
              const mod = skillModifier(modifiers[ability], true, profBonus)
              return (
                <p key={skill}>
                  {skill}: {mod >= 0 ? '+' : ''}
                  {mod}
                </p>
              )
            })}
          </div>
        </div>

        <div className="rounded-md border p-4 text-sm sm:col-span-2">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-medium">Background Narrative</p>
            <button
              type="button"
              onClick={handleGenerateNarrative}
              disabled={isGeneratingNarrative}
              className="rounded-md border px-3 py-1 text-xs hover:bg-muted disabled:opacity-50"
            >
              {isGeneratingNarrative ? 'Generating…' : draft.backgroundNarrative ? 'Regenerate' : 'Generate'}
            </button>
          </div>
          <textarea
            value={draft.backgroundNarrative}
            onChange={(e) => updateDraft({ backgroundNarrative: e.target.value })}
            rows={5}
            className="w-full rounded-md border px-2 py-1.5 text-sm"
            placeholder="Generate or write a background narrative..."
          />
        </div>
      </div>

      <div className="mt-6 flex justify-between">
        <button type="button" onClick={goBack} className="rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted">
          Back
        </button>
        <button
          type="button"
          onClick={onSave}
          disabled={isSaving || !draft.name || !srdClass}
          className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isSaving ? 'Saving…' : 'Save Character'}
        </button>
      </div>
    </div>
  )
}
