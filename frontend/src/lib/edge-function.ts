import { env } from '@/config/env'
import { supabase } from '@/lib/supabase'

/** Base URL for this project's Supabase Edge Functions, derived from the existing project URL. */
export const EDGE_FUNCTIONS_URL = `${env.supabaseUrl}/functions/v1`

/** Fetches an edge function with the current session's access token attached, if any. */
export async function callEdgeFunction(name: string, init: RequestInit = {}): Promise<Response> {
  const { data } = await supabase.auth.getSession()
  const accessToken = data.session?.access_token
  if (!accessToken) throw new Error('No active session')

  return fetch(`${EDGE_FUNCTIONS_URL}/${name}`, {
    ...init,
    headers: {
      ...init.headers,
      Authorization: `Bearer ${accessToken}`,
    },
  })
}
