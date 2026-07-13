import { useEffect, useState } from 'react'
import { getNotes } from '../api/get-notes'
import type { Note } from '../types'

export function useNotes() {
  const [notes, setNotes] = useState<Note[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    getNotes()
      .then(setNotes)
      .catch((err: Error) => setError(err.message))
  }, [])

  return { notes, error }
}
