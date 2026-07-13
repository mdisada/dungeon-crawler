import type { Session, User } from '@supabase/supabase-js'

export type SessionState = {
  session: Session | null
  user: User | null
  isLoading: boolean
}

export type SignUpResult = {
  needsEmailConfirmation: boolean
}
