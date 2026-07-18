import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'

import { useSession } from '@/features/auth'
import { deleteCharacter } from '../api/delete-character'
import { duplicateCharacter } from '../api/duplicate-character'
import { getCharacter } from '../api/get-character'
import { useCharactersList } from '../hooks/use-characters-list'
import { CharacterListSidebar } from './character-list-sidebar'
import { CharacterOverview } from './character-overview'
import type { Character } from '../types'

export function CharactersPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { session } = useSession()
  const userId = session?.user.id
  const { characters, isLoading, error, refetch } = useCharactersList(userId)
  const [selected, setSelected] = useState<Character | null>(null)
  const [selectedError, setSelectedError] = useState<string | null>(null)

  useEffect(() => {
    if (!id) return
    let cancelled = false
    getCharacter(id)
      .then((character) => {
        if (!cancelled) setSelected(character)
      })
      .catch((err: unknown) => {
        if (!cancelled) setSelectedError(err instanceof Error ? err.message : 'Failed to load character')
      })
    return () => {
      cancelled = true
    }
  }, [id])

  const displayed = id && selected?.id === id ? selected : null

  async function handleDelete() {
    if (!displayed) return
    await deleteCharacter(displayed.id)
    navigate('/characters')
    refetch()
  }

  async function handleDuplicate() {
    if (!displayed || !userId) return
    const copy = await duplicateCharacter(displayed.id, userId)
    refetch()
    navigate(`/characters/${copy.id}`)
  }

  if (isLoading) return <p className="p-8 text-muted-foreground">Loading…</p>
  if (error) return <p className="p-8 text-destructive">{error}</p>

  return (
    <div className="flex w-full min-h-[calc(100vh-4rem)]">
      <CharacterListSidebar
        characters={characters}
        selectedId={id ?? null}
        onSelect={(characterId) => navigate(`/characters/${characterId}`)}
        onNewCharacter={() => navigate('/characters/new')}
      />
      {selectedError && <p className="p-8 text-destructive">{selectedError}</p>}
      {!selectedError && displayed && (
        <CharacterOverview character={displayed} onDelete={() => void handleDelete()} onDuplicate={() => void handleDuplicate()} />
      )}
      {!selectedError && !displayed && !id && (
        <p className="flex-1 p-8 text-muted-foreground">Select a character, or create a new one.</p>
      )}
    </div>
  )
}
