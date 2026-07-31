/**
 * Turns an authored location row into a prompt for a background plate.
 *
 * Stage 4 writes image prompts for a reader, so they name the cast: "Maren's cottage, where the
 * council meets". A background plate is scenery that sits BEHIND the narration - whoever is present
 * is decided by play, and a figure painted into the plate contradicts it. So the cast is stripped
 * out before the prompt is sent, and the preset's suffix asks for an empty place (see
 * features/image/presets.ts, `background`).
 *
 * Names are matched case-sensitively on their capitalised form. That is what keeps an NPC called
 * "Ash" from gutting "ash-covered rooftops", and it holds because generated prose capitalises
 * proper nouns.
 */

/** Short tokens are too collision-prone to strip on their own ("Vex" vs "vexing"). */
const MIN_TOKEN = 4

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The phrases to remove for one name: the whole name, then its own long capitalised words. */
function phrasesFor(name: string): string[] {
  const trimmed = name.trim()
  if (!trimmed) return []
  const tokens = trimmed
    .split(/\s+/)
    .filter((token) => token.length >= MIN_TOKEN && /^[A-Z]/.test(token))
  // Longest first, so "Elder Maren" is consumed before "Maren" can leave "Elder" behind.
  return [trimmed, ...tokens].filter((p, i, all) => all.indexOf(p) === i).sort((a, b) => b.length - a.length)
}

/**
 * Removes the named cast (and the location's own name) from a prompt, then tidies the punctuation
 * the removals leave behind.
 */
export function stripNames(text: string, names: string[]): string {
  let out = text
  for (const phrase of names.flatMap(phrasesFor)) {
    // Possessives go with the name: "Maren's cottage" must become "cottage", not "'s cottage".
    out = out.replace(new RegExp(`\\b${escapeRegExp(phrase)}(?:'s|’s|')?\\b`, 'g'), ' ')
  }
  return out
    .replace(/\s*,\s*,+/g, ',') // commas orphaned by a removed clause
    .replace(/\(\s*\)/g, '')
    .replace(/\s+([,.;:])/g, '$1')
    .replace(/^[\s,;:.-]+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

/**
 * The subject line for a location's background: its authored image prompt, or its description,
 * with the cast removed. Returns an empty string when nothing usable is left, which the caller
 * treats as "nothing to draw" rather than sending a bare style suffix to the model.
 */
export function locationImageSubject(
  location: { name: string; imagePrompt: string; description: string },
  castNames: string[],
): string {
  const source = location.imagePrompt.trim() || location.description.trim()
  if (!source) return ''
  const stripped = stripNames(source, [...castNames, location.name])
  // A prompt that was nothing but names is worse than the description it came from.
  return stripped.length >= 12 ? stripped : stripNames(location.description.trim(), castNames)
}
