import { useState } from 'react'

import { validateAbilityBonusAssignment, type AbilityKey } from '@rules/character'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { SKILL_DESCRIPTIONS } from '../../content/skill-descriptions'
import { ALL_SKILLS } from '../../lib/parse-core-traits'
import { StepNav } from '../step-nav'
import type { WizardStepProps } from '../step-props'
import type { SrdBackground, SrdFeat } from '../../types'

const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'Strength',
  dex: 'Dexterity',
  con: 'Constitution',
  int: 'Intelligence',
  wis: 'Wisdom',
  cha: 'Charisma',
}

type SplitType = '2-1' | '1-1-1'

export function StepBackground({
  draft,
  updateDraft,
  goNext,
  goBack,
  backgrounds,
  feats,
}: WizardStepProps & { backgrounds: SrdBackground[]; feats: SrdFeat[] }) {
  const selected = backgrounds.find((b) => b.key === draft.backgroundKey)
  const eligible = selected?.abilityOptions ?? []
  const originFeat = selected?.feat
    ? feats.find((f) => f.name.toLowerCase() === selected.feat?.toLowerCase()) ??
      // "Magic Initiate (Cleric)" -> feat "Magic Initiate"
      feats.find((f) => selected.feat?.toLowerCase().startsWith(f.name.toLowerCase()))
    : undefined

  // splitType is real UI state, not derived from abilityBonuses: an empty/in-progress selection
  // (e.g. "2/1 chosen, but the two abilities not picked yet") has no valid bonuses to derive it
  // from, so deriving it caused the radio choice to snap back and never stick.
  const [splitType, setSplitTypeState] = useState<SplitType>(() =>
    Object.values(draft.abilityBonuses).includes(2) ? '2-1' : '1-1-1',
  )

  const entries = Object.entries(draft.abilityBonuses).filter(([, v]) => (v ?? 0) !== 0) as [AbilityKey, number][]
  const twoAbility = entries.find(([, v]) => v === 2)?.[0]
  const oneAbility = entries.find(([, v]) => v === 1 && entries.length === 2)?.[0]

  // SRD 2024: a background skill you already have (from class picks) lets you choose any other
  // skill instead. Collisions are captured at selection time - once merged into the deduped
  // skill list the two sources are indistinguishable.
  const [collisions, setCollisions] = useState<string[]>([])
  const [replacements, setReplacements] = useState<Record<string, string>>({})
  const replacementPool = ALL_SKILLS.filter((s) => !draft.skillProficiencies.includes(s))

  const selectBackground = (key: string | null) => {
    if (!key || key === draft.backgroundKey) return
    const bg = backgrounds.find((b) => b.key === key)
    setSplitTypeState('1-1-1')
    const previousGranted = selected?.skillProficiencies ?? []
    const previousReplacements = Object.values(replacements)
    const keptClassPicks = draft.skillProficiencies.filter(
      (s) => !previousGranted.includes(s) && !previousReplacements.includes(s),
    )
    setReplacements({})
    setCollisions(keptClassPicks.filter((s) => (bg?.skillProficiencies ?? []).includes(s)))
    updateDraft({
      backgroundKey: key,
      abilityBonuses: bg ? Object.fromEntries(bg.abilityOptions.map((k) => [k, 1])) : {},
      skillProficiencies: [...new Set([...keptClassPicks, ...(bg?.skillProficiencies ?? [])])],
      toolProficiencies: bg?.toolProficiency ? [bg.toolProficiency] : [],
    })
  }

  const chooseReplacement = (collidedSkill: string, replacement: string) => {
    const previous = replacements[collidedSkill]
    setReplacements((prev) => ({ ...prev, [collidedSkill]: replacement }))
    updateDraft({
      skillProficiencies: [...draft.skillProficiencies.filter((s) => s !== previous), replacement],
    })
  }

  const chooseSplitType = (type: SplitType) => {
    setSplitTypeState(type)
    if (type === '1-1-1') {
      updateDraft({ abilityBonuses: Object.fromEntries(eligible.map((k) => [k, 1])) })
    } else {
      updateDraft({ abilityBonuses: {} })
    }
  }

  const validation = validateAbilityBonusAssignment(draft.abilityBonuses, eligible)

  return (
    <div>
      <h2 className="mb-4 text-xl font-semibold">Background</h2>
      <Label htmlFor="background-select">Choose a background</Label>
      <Select value={draft.backgroundKey ?? undefined} onValueChange={selectBackground}>
        <SelectTrigger id="background-select" className="mt-2 w-full max-w-sm">
          <SelectValue placeholder="Select a background">
            {(value: string | null) => backgrounds.find((b) => b.key === value)?.name ?? 'Select a background'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          {backgrounds.map((bg) => (
            <SelectItem key={bg.key} value={bg.key}>
              {bg.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {selected && (
        <div className="mt-6 space-y-4">
          <div className="rounded-md border p-4">
            <p className="mb-2 text-sm font-medium">Skill Proficiencies</p>
            <div className="space-y-1.5">
              {selected.skillProficiencies.map((skill) => (
                <div key={skill} className="text-sm">
                  <span className="font-medium">{skill}</span>
                  {SKILL_DESCRIPTIONS[skill] && (
                    <span className="text-muted-foreground"> — {SKILL_DESCRIPTIONS[skill]}</span>
                  )}
                </div>
              ))}
            </div>
            {collisions.map((skill) => (
              <div key={skill} className="mt-3 rounded-md bg-muted p-3 text-sm">
                <p className="mb-2">
                  You already chose <span className="font-medium">{skill}</span> from your class, so this
                  background lets you pick a different skill instead:
                </p>
                <Select
                  value={replacements[skill]}
                  onValueChange={(value) => value && chooseReplacement(skill, value)}
                >
                  <SelectTrigger className="w-56" aria-label={`Replacement skill for ${skill}`}>
                    <SelectValue placeholder="Pick a replacement skill">
                      {(value: string | null) => value ?? 'Pick a replacement skill'}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {(replacements[skill] ? [replacements[skill], ...replacementPool] : replacementPool).map(
                      (s) => (
                        <SelectItem key={s} value={s}>
                          {s}
                        </SelectItem>
                      ),
                    )}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </div>

          {selected.toolProficiency && (
            <div className="rounded-md border p-4">
              <p className="mb-1 text-sm font-medium">Tool Proficiency</p>
              <p className="text-sm text-muted-foreground">{selected.toolProficiency}</p>
            </div>
          )}

          {selected.feat && (
            <div className="rounded-md border p-4">
              <p className="mb-1 text-sm font-medium">Origin Feat: {selected.feat}</p>
              {originFeat?.description && (
                <p className="text-sm text-muted-foreground">{originFeat.description}</p>
              )}
              {originFeat && originFeat.benefits.length > 0 && (
                <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                  {originFeat.benefits.map((benefit) => (
                    <li key={benefit.desc}>{benefit.desc}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="rounded-md border p-4">
            <p className="mb-2 text-sm font-medium">Ability Score Bonus</p>
            <p className="mb-2 text-xs text-muted-foreground">
              This background boosts {eligible.map((k) => ABILITY_LABELS[k]).join(', ')} — assign +2/+1 to
              two of them, or +1 to all three.
            </p>
            <div className="flex gap-4 text-sm">
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="split-type"
                  checked={splitType === '2-1'}
                  onChange={() => chooseSplitType('2-1')}
                />
                +2 / +1 to two abilities
              </label>
              <label className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="split-type"
                  checked={splitType === '1-1-1'}
                  onChange={() => chooseSplitType('1-1-1')}
                />
                +1 / +1 / +1 to all three
              </label>
            </div>

            {splitType === '2-1' && (
              <div className="mt-3 flex gap-4">
                <div>
                  <Label htmlFor="bonus-two">+2 to</Label>
                  <Select
                    value={twoAbility}
                    onValueChange={(value) => {
                      if (!value) return
                      const key = value as AbilityKey
                      const currentOne = oneAbility && oneAbility !== key ? oneAbility : undefined
                      updateDraft({
                        abilityBonuses: currentOne ? { [key]: 2, [currentOne]: 1 } : { [key]: 2 },
                      })
                    }}
                  >
                    <SelectTrigger id="bonus-two" className="mt-1 w-40">
                      <SelectValue placeholder="Choose">
                        {(value: string | null) => (value ? ABILITY_LABELS[value as AbilityKey] : 'Choose')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {eligible.map((key) => (
                        <SelectItem key={key} value={key}>
                          {ABILITY_LABELS[key]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label htmlFor="bonus-one">+1 to</Label>
                  <Select
                    value={oneAbility}
                    onValueChange={(value) => {
                      if (!twoAbility || !value) return
                      updateDraft({ abilityBonuses: { [twoAbility]: 2, [value as AbilityKey]: 1 } })
                    }}
                  >
                    <SelectTrigger id="bonus-one" className="mt-1 w-40">
                      <SelectValue placeholder="Choose">
                        {(value: string | null) => (value ? ABILITY_LABELS[value as AbilityKey] : 'Choose')}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {eligible
                        .filter((k) => k !== twoAbility)
                        .map((key) => (
                          <SelectItem key={key} value={key}>
                            {ABILITY_LABELS[key]}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            )}

            {!validation.valid && entries.length > 0 && splitType === '2-1' && (twoAbility === undefined || oneAbility === undefined) && (
              <p className="mt-2 text-sm text-muted-foreground">Pick which ability gets +2 and which gets +1.</p>
            )}
          </div>
        </div>
      )}

      <StepNav
        onBack={goBack}
        onNext={goNext}
        nextDisabled={!selected || !validation.valid || collisions.some((s) => !replacements[s])}
      />
    </div>
  )
}
