// UI gate for the Debug sidebar tab. Mirror of the server allowlist in
// supabase/functions/session/debug.ts - the server re-checks before returning usage rows.
const DEBUG_EMAILS = ['mig.isada@gmail.com']

export function isDebugUser(email: string | null | undefined): boolean {
  return !!email && DEBUG_EMAILS.includes(email.toLowerCase())
}
