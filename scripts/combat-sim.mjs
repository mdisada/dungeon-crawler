// Combat balance sweep (F09 SS10 tuning). Runs each scenario headless over a fixed seed set under
// every difficulty preset and prints the numbers a balance pass needs. Zero I/O beyond stdout - the
// engine is pure, so this is a measurement you can re-run and diff.
//
//   node scripts/combat-sim.mjs                       # every scenario x every preset, 200 seeds
//   node scripts/combat-sim.mjs --runs 500
//   node scripts/combat-sim.mjs --scenario ogre       # label substring filter
//   node scripts/combat-sim.mjs --preset Standard
//   node scripts/combat-sim.mjs --manifest fight.json # a CombatManifest exported from the Lab
//   node scripts/combat-sim.mjs --party-morale 0.25   # party withdraws below 25% side strength
//   node scripts/combat-sim.mjs --json                # machine-readable, for diffing runs
//
// Needs Node >= 23 (native TypeScript import). Every combatant is driven by the minion heuristic,
// which is exactly how live play resolves a fight today (session/combat.ts).

import { readFileSync } from 'node:fs'

import { buildManifest, DIFFICULTY_PRESETS, sweepDifficulty } from '../packages/rules/src/combat/index.ts'

// A standard four-role party. AC now comes from each class's starting kit (fighter 18, cleric 18,
// rogue 13, wizard 12 at DEX 14), which is the single biggest lever on these numbers.
const PARTY_ABILITIES = { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 10 }
const PARTY_CLASSES = ['srd-2024_fighter', 'srd-2024_cleric', 'srd-2024_rogue', 'srd-2024_wizard']
const hpForLevel = (level) => 8 + (level - 1) * 6

const OPEN_FIELD = { mapId: null, obstacles: [], spawns: { party: [], enemy: [] }, gridWidth: 20, gridHeight: 20 }

/** An escalating ladder over the SRD fixture set - patrol through climax, plus a solo-play case. */
const SCENARIOS = [
  { label: 'party 4 (L1) vs 4x Goblin', party: { count: 4, level: 1 }, enemies: [['Goblin', 4]] },
  { label: 'party 4 (L1) vs 2x Orc', party: { count: 4, level: 1 }, enemies: [['Orc', 2]] },
  { label: 'party 4 (L3) vs 6x Goblin', party: { count: 4, level: 3 }, enemies: [['Goblin', 6]] },
  { label: 'party 4 (L3) vs 1x Ogre', party: { count: 4, level: 3 }, enemies: [['Ogre', 1]] },
  { label: 'party 4 (L3) vs Mage + 4x Bandit', party: { count: 4, level: 3 }, enemies: [['Mage', 1], ['Bandit', 4]] },
  { label: 'party 4 (L5) vs Priest + 6x Skeleton', party: { count: 4, level: 5 }, enemies: [['Priest', 1], ['Skeleton', 6]] },
  { label: 'party 1 (L3) vs 2x Wolf [solo]', party: { count: 1, level: 3 }, enemies: [['Wolf', 2]] },
]

function scenarioManifest(scenario) {
  return buildManifest({
    encounterId: scenario.label,
    enemies: scenario.enemies.map(([name, count]) => ({ name, cr: '1', count })),
    npcs: [],
    party: Array.from({ length: scenario.party.count }, (_, i) => ({
      id: `pc${i + 1}`,
      name: `PC${i + 1}`,
      level: scenario.party.level,
      classKey: PARTY_CLASSES[i % PARTY_CLASSES.length],
      abilities: PARTY_ABILITIES,
      abilityBonuses: null,
      hpMax: hpForLevel(scenario.party.level),
    })),
    map: OPEN_FIELD,
  })
}

function parseArgs(argv) {
  // partyMorale stays null unless asked for, so buildManifest's own default policy is what gets
  // measured by default (overwriting it with 0 would silently disable the party retreat rule).
  const args = { runs: 200, scenario: null, preset: null, manifest: null, json: false, partyMorale: null }
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i]
    if (flag === '--json') args.json = true
    else if (flag === '--runs') args.runs = Number(argv[++i])
    else if (flag === '--scenario') args.scenario = argv[++i]
    else if (flag === '--preset') args.preset = argv[++i]
    else if (flag === '--manifest') args.manifest = argv[++i]
    else if (flag === '--party-morale') args.partyMorale = Number(argv[++i])
    else {
      console.error(`Unknown argument: ${flag}`)
      process.exit(1)
    }
  }
  if (!Number.isFinite(args.runs) || args.runs < 1) {
    console.error('--runs must be a positive number')
    process.exit(1)
  }
  if (args.partyMorale !== null && (!Number.isFinite(args.partyMorale) || args.partyMorale < 0 || args.partyMorale > 1)) {
    console.error('--party-morale must be between 0 and 1')
    process.exit(1)
  }
  return args
}

const pct = (x) => `${Math.round(x * 100)}%`
const pad = (text, width) => String(text).padEnd(width)
const padStart = (text, width) => String(text).padStart(width)

const COLUMNS = [
  ['preset', 10],
  ['win%', 6],
  ['full', 6],
  ['partial', 8],
  ['failed', 7],
  ['TPK%', 6],
  ['retreat', 8],
  ['rnd med', 8],
  ['rnd p90', 8],
  ['HP left', 8],
  ['stall%', 7],
]

function printTable(summaries) {
  console.log('  ' + COLUMNS.map(([name, width]) => (name === 'preset' ? pad(name, width) : padStart(name, width))).join(' '))
  for (const s of summaries) {
    const cells = [
      pad(s.difficulty, COLUMNS[0][1]),
      padStart(pct(s.winRate), COLUMNS[1][1]),
      padStart(pct(s.tierRates.full), COLUMNS[2][1]),
      padStart(pct(s.tierRates.partial), COLUMNS[3][1]),
      padStart(pct(s.tierRates.failed), COLUMNS[4][1]),
      padStart(pct(s.tpkRate), COLUMNS[5][1]),
      padStart(pct(s.retreatRate), COLUMNS[6][1]),
      padStart(s.rounds.median, COLUMNS[7][1]),
      padStart(s.rounds.p90, COLUMNS[8][1]),
      padStart(pct(s.partyHp.mean), COLUMNS[9][1]),
      padStart(pct(s.stalledRate), COLUMNS[10][1]),
    ]
    console.log('  ' + cells.join(' '))
    if (s.errors.length > 0) console.log(`    ! ${s.errors.join(' | ')}`)
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2))
  const presets = args.preset
    ? DIFFICULTY_PRESETS.filter((p) => p.name.toLowerCase() === args.preset.toLowerCase())
    : DIFFICULTY_PRESETS
  if (presets.length === 0) {
    console.error(`Unknown preset "${args.preset}". Known: ${DIFFICULTY_PRESETS.map((p) => p.name).join(', ')}`)
    process.exit(1)
  }

  const fights = args.manifest
    ? [{ label: args.manifest, manifest: JSON.parse(readFileSync(args.manifest, 'utf8')) }]
    : SCENARIOS.filter((s) => !args.scenario || s.label.toLowerCase().includes(args.scenario.toLowerCase()))
        .map((s) => ({ label: s.label, manifest: scenarioManifest(s) }))

  if (args.partyMorale !== null) {
    for (const { manifest } of fights) {
      for (const pc of manifest.party) pc.morale = args.partyMorale
    }
  }

  if (fights.length === 0) {
    console.error(`No scenario matched "${args.scenario}".`)
    process.exit(1)
  }

  const report = fights.map(({ label, manifest }) => ({
    label,
    warnings: manifest.warnings,
    summaries: sweepDifficulty(manifest, presets, { runs: args.runs, label }),
  }))

  if (args.json) {
    // Drop per-run records: the aggregate is what a diff between two runs should compare.
    console.log(JSON.stringify(
      report.map((r) => ({ ...r, summaries: r.summaries.map(({ records: _records, ...rest }) => rest) })),
      null,
      2,
    ))
    return
  }

  console.log(`\n${args.runs} seeds per cell - every combatant driven by the minion heuristic.`)
  console.log('HP left = mean party HP remaining at the end (the margin a win had).')
  const moraleNote = args.partyMorale === null ? 'manifest default' : `overridden to ${args.partyMorale}`
  console.log(`retreat = share of LOSSES the party walked away from (party morale: ${moraleNote}).\n`)
  for (const { label, warnings, summaries } of report) {
    console.log(label)
    if (warnings.length > 0) console.log(`  initiator warnings: ${warnings.join(' | ')}`)
    printTable(summaries)
    console.log('')
  }
}

main()
