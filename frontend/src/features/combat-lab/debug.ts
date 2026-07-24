// Combat Lab allowlist (F09 SS9). Deliberately its own list rather than the play feature's
// debug.ts: the Lab must leave features/play untouched, and granting madisada@ Lab access
// must not widen the play Debug tab.
const LAB_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']

export function isLabUser(email: string | null | undefined): boolean {
  return !!email && LAB_EMAILS.includes(email.toLowerCase())
}
