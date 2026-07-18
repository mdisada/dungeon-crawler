// Clickable suggestion chips for the Personality step. Clicking one appends it to the freeform
// "what makes this character unique" textarea; players mix them with their own text.

export const QUIRK_SUGGESTIONS = [
  'Talks to their weapon like an old friend',
  'Collects a small trinket from every place they visit',
  'Never sits with their back to a door',
  'Hums old battle hymns when nervous',
  'Quotes a proverb for every occasion, often wrongly',
  'Refuses to eat before everyone else has been served',
  'Keeps a journal of every meal they have eaten',
  'Superstitious about the number three',
  'Always pays debts within a day, coin or favor',
  'Laughs at danger - genuinely, and at the worst times',
  'Sleeps with one eye open, or claims to',
  'Names every horse, mule, and stray dog they meet',
]

export const HISTORY_SUGGESTIONS = [
  'Sole survivor of a village lost to a raid',
  'Former soldier who deserted over an unjust order',
  'Raised in a temple but never truly believed',
  'Owes a life-debt to a mysterious stranger',
  'Exiled from home for a crime they did not commit',
  'Grew up on the streets running errands for a thieves guild',
  'Last apprentice of a master who vanished',
  'Left a comfortable noble life in search of meaning',
  'Haunted by a prophecy spoken at their birth',
  'Searching for a sibling who disappeared years ago',
]

export const APPEARANCE_SUGGESTIONS = [
  'A jagged scar across one eyebrow',
  'Intricate tattoos winding down one arm',
  'Clothes fine once, now patched and travel-worn',
  'Eyes that seem older than their face',
  'A missing finger they never explain',
  'Always immaculately groomed, even in the wild',
  'Carries the smell of woodsmoke and leather',
  'A streak of white in otherwise dark hair',
]

// Race-flavored appearance extras, keyed by srd_races.key.
export const RACE_APPEARANCE_SUGGESTIONS: Record<string, string[]> = {
  'srd-2024_dragonborn': ['Scales that shimmer when angry', 'Chipped horn from an old duel'],
  'srd-2024_dwarf': ['A beard braided with clan rings', 'Hands calloused from the forge'],
  'srd-2024_elf': ['Moves without a sound, even at rest', 'Faint starlight sheen to their eyes'],
  'srd-2024_gnome': ['Pockets full of half-finished gadgets', 'Ink-stained fingers'],
  'srd-2024_goliath': ['Skin patterned like weathered stone', 'Ritual paint marking past victories'],
  'srd-2024_halfling': ['Bare feet, tough as boot leather', 'A grin that invites trust'],
  'srd-2024_human': ['A face that blends into any crowd', 'Sun-lined skin from years on the road'],
  'srd-2024_orc': ['A proudly displayed broken tusk', 'Ritual scars in deliberate patterns'],
  'srd-2024_tiefling': ['Horns filed and polished to a shine', 'A tail that betrays their mood'],
}
