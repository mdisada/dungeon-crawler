import { supabase } from '@/lib/supabase'
import type { SignUpResult } from '../types'

export async function signUpWithPassword(email: string, password: string): Promise<SignUpResult> {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  return { needsEmailConfirmation: data.session === null }
}
