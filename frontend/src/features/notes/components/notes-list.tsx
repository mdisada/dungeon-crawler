import { useNotes } from '../hooks/use-notes'

export function NotesList() {
  const { notes, error } = useNotes()

  if (error) return <pre>Supabase error: {error}</pre>
  return <pre>{JSON.stringify(notes, null, 2)}</pre>
}
