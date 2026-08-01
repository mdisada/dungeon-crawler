// TTS Lab allowlist - its own list, following the combat-lab / adventure-lab / assets-lab
// precedent: granting access to one lab must never widen another, and this one spends real AI
// credit whenever it is pointed at a paid engine.
const LAB_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']

export function isTtsLabUser(email: string | null | undefined): boolean {
  return !!email && LAB_EMAILS.includes(email.toLowerCase())
}
