import { useNavigate } from 'react-router-dom'

import { abilityModifier, ABILITY_KEYS, applyAbilityBonuses, armorClass, type AbilityKey } from '@rules/character'
import { useCharacterImageUrl } from '../hooks/use-character-image-url'
import { useSrdReferenceData } from '../hooks/use-srd-reference-data'
import { DeleteCharacterDialog } from './delete-character-dialog'
import type { Character } from '../types'

const ABILITY_LABELS: Record<AbilityKey, string> = {
  str: 'STR',
  dex: 'DEX',
  con: 'CON',
  int: 'INT',
  wis: 'WIS',
  cha: 'CHA',
}

export function CharacterOverview({
  character,
  onDelete,
  onDuplicate,
}: {
  character: Character
  onDelete: () => void
  onDuplicate: () => void
}) {
  const navigate = useNavigate()
  const { races, classes, backgrounds } = useSrdReferenceData()
  const portraitUrl = useCharacterImageUrl(character.images.portraitUrl)
  const avatarUrl = useCharacterImageUrl(character.images.avatarUrl)
  const tokenUrl = useCharacterImageUrl(character.images.tokenUrl)

  const race = races.find((r) => r.key === character.raceKey)
  const srdClass = classes.find((c) => c.key === character.classKey)
  const background = backgrounds.find((b) => b.key === character.backgroundKey)

  const finalAbilities = applyAbilityBonuses(character.abilities, character.abilityBonuses)
  const dexMod = abilityModifier(finalAbilities.dex)
  const ac = armorClass({ dexModifier: dexMod })

  return (
    <div className="flex-1 p-6">
      <div className="flex items-start gap-6">
        <div className="size-32 shrink-0 overflow-hidden rounded-md bg-muted">
          {avatarUrl && <img src={avatarUrl} alt="" className="size-full object-cover" />}
        </div>
        <div>
          <h1 className="text-2xl font-semibold">{character.name || 'Unnamed character'}</h1>
          <p className="text-muted-foreground">
            {race?.name} {srdClass?.name} · Level {character.level}
            {character.alignment ? ` · ${character.alignment}` : ''}
          </p>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => navigate(`/characters/${character.id}/edit`)}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Edit
            </button>
            <button
              type="button"
              onClick={onDuplicate}
              className="rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted"
            >
              Duplicate
            </button>
            <DeleteCharacterDialog characterName={character.name} onConfirm={onDelete} />
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-6 sm:grid-cols-2">
        <div className="rounded-md border p-4">
          <p className="mb-3 text-sm font-medium">Abilities</p>
          <div className="grid grid-cols-3 gap-3 text-center text-sm">
            {ABILITY_KEYS.map((key) => (
              <div key={key}>
                <p className="text-xs text-muted-foreground">{ABILITY_LABELS[key]}</p>
                <p className="font-medium">{finalAbilities[key]}</p>
                <p className="text-xs text-muted-foreground">
                  {abilityModifier(finalAbilities[key]) >= 0 ? '+' : ''}
                  {abilityModifier(finalAbilities[key])}
                </p>
              </div>
            ))}
          </div>
          <div className="mt-4 flex gap-6 text-sm">
            <p>
              <span className="text-muted-foreground">AC</span> {ac}
            </p>
            <p>
              <span className="text-muted-foreground">HP</span> {character.hpCurrent ?? character.hpMax ?? '—'} /{' '}
              {character.hpMax ?? '—'}
            </p>
          </div>
        </div>

        <div className="rounded-md border p-4">
          <p className="mb-2 text-sm font-medium">Skills</p>
          <p className="text-sm text-muted-foreground">{character.skillProficiencies.join(', ') || 'None'}</p>
          <p className="mt-3 text-sm font-medium">Background</p>
          <p className="text-sm text-muted-foreground">{background?.name ?? '—'}</p>
        </div>

        {character.backgroundNarrative && (
          <div className="rounded-md border p-4 sm:col-span-2">
            <p className="mb-2 text-sm font-medium">Background</p>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{character.backgroundNarrative}</p>
          </div>
        )}

        <div className="rounded-md border p-4 sm:col-span-2">
          <p className="mb-2 text-sm font-medium">Image Set</p>
          <div className="flex gap-4">
            {[
              { label: 'Avatar', url: avatarUrl },
              { label: 'Token', url: tokenUrl },
              { label: 'Portrait', url: portraitUrl },
            ].map(({ label, url }) => (
              <div key={label} className="text-center">
                <div className="size-16 overflow-hidden rounded-md bg-muted">
                  {url && <img src={url} alt="" className="size-full object-cover" />}
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{label}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
