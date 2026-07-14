import type { Archetype } from './types'

// Standalone topic (not campaign-builder) so a slow compile can't race the wizard's other
// requests on a shared topic — mirrors backend/main.py's puzzle-compile channel.
export const PUZZLE_COMPILE_TOPIC = 'puzzle-compile'

export const TIMEOUTS = {
  compilePuzzle: 90_000,
  detectPuzzles: 90_000,
} as const

// Ordered simple -> complex; mirrors backend/campaign/puzzles.py's ARCHETYPES exactly.
export const ARCHETYPES: Archetype[] = [
  { id: 'riddle', label: 'Riddle', presentation: 'text',
    seed: 'A guardian poses a riddle; players must speak the correct answer aloud.' },
  { id: 'cipher', label: 'Cipher', presentation: 'text',
    seed: 'A coded message must be deciphered; the key is hidden in nearby clues.' },
  { id: 'truth-liar', label: 'Truth-teller & liar', presentation: 'text',
    seed: 'Two guardians, one always lies and one always tells the truth; players may question them, then must choose.' },
  { id: 'cursed-choice', label: 'Cursed choice', presentation: 'text',
    seed: 'Several doors or offerings, each exacting a different price; there is no free option.' },
  { id: 'trading-chain', label: 'Trading chain', presentation: 'text',
    seed: 'A chain of characters who each want something another one holds; satisfy them all to earn the prize.' },
  { id: 'pressure-plates', label: 'Pressure plates', presentation: 'map',
    seed: 'Floor plates that must be held down in the right combination to open the way.' },
  { id: 'lever-combination', label: 'Lever combination', presentation: 'map',
    seed: 'A bank of levers that must be set to the correct positions; clues hint at the combination.' },
  { id: 'sequence', label: 'Sequence', presentation: 'map',
    seed: 'Objects that must be activated in a specific order; a mistake resets the progress.' },
  { id: 'elemental-altars', label: 'Elemental altars', presentation: 'map',
    seed: 'Altars of fire, water, earth and air that must be attuned in the right order.' },
  { id: 'skill-gauntlet', label: 'Skill gauntlet', presentation: 'map',
    seed: 'Physical obstacles gated by ability checks - a stuck door, a crumbling ledge, a chasm jump.' },
  { id: 'light-beams', label: 'Light beams', presentation: 'map',
    seed: 'Rotatable mirrors that must be oriented so a light beam reaches its target.' },
  { id: 'timed-escape', label: 'Timed escape', presentation: 'map',
    seed: 'The room is closing in; players have a limited number of attempts to find the way out.' },
  { id: 'contraption', label: 'Contraption', presentation: 'map',
    seed: 'A multi-stage mechanism where each solved part unlocks or changes the next.' },
  { id: 'custom', label: 'Custom', presentation: 'text', seed: '' },
]
