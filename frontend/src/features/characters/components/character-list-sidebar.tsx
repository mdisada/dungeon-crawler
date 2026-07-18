import { useCharacterImageUrl } from '../hooks/use-character-image-url'
import type { CharacterSummary } from '../types'

function CharacterListItem({
  character,
  isSelected,
  onSelect,
}: {
  character: CharacterSummary
  isSelected: boolean
  onSelect: () => void
}) {
  const avatarUrl = useCharacterImageUrl(character.avatarUrl)

  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        className={`flex w-full items-center gap-3 rounded-md px-3 py-2 text-left text-sm hover:bg-muted ${
          isSelected ? 'bg-muted font-medium' : ''
        }`}
      >
        <span className="flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-muted-foreground/10">
          {avatarUrl ? (
            <img src={avatarUrl} alt="" className="size-full object-cover" />
          ) : (
            <span aria-hidden className="text-xs text-muted-foreground">
              ?
            </span>
          )}
        </span>
        <span className="min-w-0">
          <span className="block truncate">{character.name || 'Unnamed'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {character.classKey ?? 'Draft'} · Lvl {character.level}
            {!character.isComplete && ' · In progress'}
          </span>
        </span>
      </button>
    </li>
  )
}

export function CharacterListSidebar({
  characters,
  selectedId,
  onSelect,
  onNewCharacter,
}: {
  characters: CharacterSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  onNewCharacter: () => void
}) {
  return (
    <nav aria-label="Your characters" className="w-64 shrink-0 border-r p-4">
      <button
        type="button"
        onClick={onNewCharacter}
        className="mb-4 w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
      >
        New Character
      </button>
      <ul className="space-y-1">
        {characters.map((character) => (
          <CharacterListItem
            key={character.id}
            character={character}
            isSelected={character.id === selectedId}
            onSelect={() => onSelect(character.id)}
          />
        ))}
      </ul>
      {characters.length === 0 && <p className="text-sm text-muted-foreground">No characters yet.</p>}
    </nav>
  )
}
