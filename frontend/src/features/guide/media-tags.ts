/**
 * The closed vocabulary location art is filed under. Closed because tags are only useful if the
 * same place gets the same word every time - "wood" and "woods" and "forest" on three rows means
 * three shelves nobody can search.
 *
 * A superset of MAP_TAG_SUGGESTIONS (features/map-editor), which battle maps already use, so a tag
 * means the same thing whichever shelf it is on.
 */
export const LOCATION_TAGS = [
  // settlement
  'city',
  'town',
  'village',
  'street',
  'market',
  // built interior
  'interior',
  'room',
  'tavern',
  'temple',
  'keep',
  'prison',
  'ship',
  // underground
  'dungeon',
  'crypt',
  'cave',
  'mine',
  'ruins',
  // outdoors
  'forest',
  'mountain',
  'river',
  'coast',
  'swamp',
  'desert',
  'plains',
  'road',
  'camp',
  'wilderness',
] as const

export type LocationTag = (typeof LOCATION_TAGS)[number]

const VOCABULARY = new Set<string>(LOCATION_TAGS)

/** Keeps only real tags, lowercased and deduped, capped so one row cannot claim every shelf. */
export function normalizeTags(candidates: unknown, limit = 4): LocationTag[] {
  if (!Array.isArray(candidates)) return []
  const seen = new Set<string>()
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue
    const tag = candidate.trim().toLowerCase()
    if (VOCABULARY.has(tag)) seen.add(tag)
    if (seen.size >= limit) break
  }
  return [...seen] as LocationTag[]
}

/**
 * A deterministic fallback: the words of the location itself, matched against the vocabulary. Weaker
 * than asking the model (it cannot tell that "the Sunken Vault" is a dungeon) but free, instant, and
 * enough to keep the shelf usable when the model call fails.
 */
export function tagsFromText(text: string, limit = 4): LocationTag[] {
  const words = text.toLowerCase()
  const hits = LOCATION_TAGS.filter((tag) => new RegExp(`\\b${tag}s?\\b`).test(words))
  return hits.slice(0, limit)
}
