import type { CoreTraitsResult } from './parse-core-traits'

// The seeded SRD data is missing the "Core <Class> Traits" feature for some classes (currently
// only Cleric), so their skill/equipment choices can't be parsed from the class payload. Values
// below are transcribed from the same SRD 5.2.1 source (CC-BY-4.0, see NOTICE.md). Remove an
// entry if a future re-ingest starts including the class's Core Traits feature.
export const FALLBACK_CORE_TRAITS: Record<string, CoreTraitsResult> = {
  'srd-2024_cleric': {
    skillChoiceCount: 2,
    skillChoices: ['History', 'Insight', 'Medicine', 'Persuasion', 'Religion'],
    equipmentOptions: [
      { letter: 'A', desc: "Chain Shirt, Shield, Mace, Holy Symbol, Priest's Pack, 7 GP" },
      { letter: 'B', desc: '110 GP' },
    ],
    table: {
      'Primary Ability': 'Wisdom',
      'Hit Point Die': 'D8 per Cleric level',
      'Saving Throw Proficiencies': 'Wisdom and Charisma',
      'Skill Proficiencies': 'Choose 2: History, Insight, Medicine, Persuasion, or Religion',
      'Weapon Proficiencies': 'Simple weapons',
      'Armor Training': 'Light and Medium armor and Shields',
      'Starting Equipment':
        "Choose A or B: (A) Chain Shirt, Shield, Mace, Holy Symbol, Priest's Pack, 7 GP; or (B) 110 GP",
    },
  },
}
