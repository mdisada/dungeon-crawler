// SHA-256 hex digest via the Web Crypto API (available natively in the Deno edge runtime --
// no external dependency needed for a one-way token hash).
export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token)
  const digest = await crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
}
