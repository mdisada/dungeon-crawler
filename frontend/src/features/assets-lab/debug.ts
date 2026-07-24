// Assets Lab allowlist - its own list, following the combat-lab and adventure-lab precedent:
// granting access to one lab must never widen another, and the lab spends real AI credit.
const LAB_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']

export function isAssetsLabUser(email: string | null | undefined): boolean {
  return !!email && LAB_EMAILS.includes(email.toLowerCase())
}
