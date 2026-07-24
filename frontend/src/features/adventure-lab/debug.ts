// Adventure Lab allowlist - its own list (combat-lab precedent): granting lab access must not
// widen the play Debug tab, and the lab must leave other features untouched.
const LAB_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']

export function isAdventureLabUser(email: string | null | undefined): boolean {
  return !!email && LAB_EMAILS.includes(email.toLowerCase())
}
