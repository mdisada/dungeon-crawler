// Replay sandbox allowlist. Its own list, like the Combat Lab's: this surface can flip an
// adventure's status, so widening it must be a deliberate edit here and nowhere else. The
// server enforces the same list - this only decides what the UI offers.
const REPLAY_EMAILS = ['mig.isada@gmail.com', 'madisada@gmail.com']

export function isReplayUser(email: string | null | undefined): boolean {
  return !!email && REPLAY_EMAILS.includes(email.toLowerCase())
}
