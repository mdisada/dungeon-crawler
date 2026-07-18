import type { Physical } from '../types'

interface PhysicalProfile {
  ageRange: [number, number]
  heightRangeInches: [number, number]
  hairColors: string[]
  eyeColors: string[]
}

const COMMON_HAIR = ['black', 'brown', 'dark brown', 'auburn', 'blond', 'gray']
const COMMON_EYES = ['brown', 'hazel', 'green', 'blue', 'gray']

// Adult age ranges and typical heights per SRD 5.2.1 species (heights follow each species' size
// description; lifespans follow their trait prose - elves/dwarves live far longer than humans).
const PROFILES: Record<string, PhysicalProfile> = {
  'srd-2024_dragonborn': {
    ageRange: [16, 70],
    heightRangeInches: [66, 80],
    hairColors: ['none (crimson scales)', 'none (bronze scales)', 'none (gold scales)', 'none (blue scales)', 'none (silver scales)'],
    eyeColors: ['red', 'gold', 'amber', 'green', 'ice blue'],
  },
  'srd-2024_dwarf': {
    ageRange: [40, 320],
    heightRangeInches: [48, 58],
    hairColors: [...COMMON_HAIR, 'fiery red', 'white'],
    eyeColors: [...COMMON_EYES, 'deep amber'],
  },
  'srd-2024_elf': {
    ageRange: [100, 700],
    heightRangeInches: [60, 72],
    hairColors: [...COMMON_HAIR, 'silver-white', 'copper'],
    eyeColors: [...COMMON_EYES, 'violet', 'gold'],
  },
  'srd-2024_gnome': {
    ageRange: [40, 400],
    heightRangeInches: [36, 44],
    hairColors: [...COMMON_HAIR, 'white', 'russet'],
    eyeColors: [...COMMON_EYES, 'glittering black'],
  },
  'srd-2024_goliath': {
    ageRange: [18, 80],
    heightRangeInches: [84, 96],
    hairColors: ['none (bald)', 'black', 'dark brown', 'gray'],
    eyeColors: ['blue', 'green', 'gray', 'stone-flecked'],
  },
  'srd-2024_halfling': {
    ageRange: [20, 150],
    heightRangeInches: [32, 38],
    hairColors: [...COMMON_HAIR, 'sandy', 'chestnut'],
    eyeColors: COMMON_EYES,
  },
  'srd-2024_human': {
    ageRange: [18, 75],
    heightRangeInches: [58, 74],
    hairColors: COMMON_HAIR,
    eyeColors: COMMON_EYES,
  },
  'srd-2024_orc': {
    ageRange: [14, 70],
    heightRangeInches: [70, 82],
    hairColors: ['black', 'dark brown', 'gray', 'none (shaved)'],
    eyeColors: ['red', 'amber', 'brown', 'yellow'],
  },
  'srd-2024_tiefling': {
    ageRange: [18, 90],
    heightRangeInches: [58, 74],
    hairColors: [...COMMON_HAIR, 'dark blue', 'purple-black'],
    eyeColors: ['solid black', 'solid red', 'solid gold', 'solid silver', 'solid white'],
  },
}

const DEFAULT_PROFILE: PhysicalProfile = {
  ageRange: [18, 75],
  heightRangeInches: [58, 74],
  hairColors: COMMON_HAIR,
  eyeColors: COMMON_EYES,
}

function randomInt(min: number, max: number): number {
  return min + Math.floor(Math.random() * (max - min + 1))
}

function pick<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)]
}

function formatHeight(inches: number): string {
  return `${Math.floor(inches / 12)}'${inches % 12}"`
}

// Age skews toward the lower half of the lifespan (a 650-year-old elf adventurer should be rare,
// not the median roll).
export function randomPhysical(raceKey: string | null): Pick<Physical, 'age' | 'height' | 'hair' | 'eyes'> {
  const profile = (raceKey && PROFILES[raceKey]) || DEFAULT_PROFILE
  const [minAge, maxAge] = profile.ageRange
  const age = Math.min(randomInt(minAge, maxAge), randomInt(minAge, maxAge))
  return {
    age: String(age),
    height: formatHeight(randomInt(...profile.heightRangeInches)),
    hair: pick(profile.hairColors),
    eyes: pick(profile.eyeColors),
  }
}
