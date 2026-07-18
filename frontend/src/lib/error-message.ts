/** Extracts a human-readable message from an unknown thrown value, including Supabase/PostgREST
 *  error objects (which are plain objects with a `message` field, not Error instances). */
export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (error && typeof error === 'object' && 'message' in error) {
    const message = (error as { message: unknown }).message
    if (typeof message === 'string') return message
  }
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}
