#!/usr/bin/env node
// Seeds 2 complete, SRD-legal level-1 demo characters for a given user, using placeholder image
// paths (frontend/public/placeholders/*.png) so no image-gen credit is spent. Required to work
// from Phase 2 onward (DEVELOPMENT-PLAN.md SS1.3's PLACEHOLDER_MEDIA=true / SEED_DEMO=true rule)
// so the user always has characters to test F02+ features against without running the wizard.
//
// Usage: node supabase/seed/seed-demo-characters.mjs <postgres-connection-string> <user-email>

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const [dbUrl, userEmail] = process.argv.slice(2)
if (!dbUrl || !userEmail) {
  console.error('Usage: node supabase/seed/seed-demo-characters.mjs <postgres-connection-string> <user-email>')
  process.exit(1)
}

async function runQuery(sql) {
  const dir = await mkdtemp(join(tmpdir(), 'seed-demo-'))
  try {
    const file = join(dir, 'query.sql')
    await writeFile(file, sql)
    const { stdout } = await execFileAsync(
      'npx',
      ['--yes', 'supabase', 'db', 'query', '--file', file, '--db-url', dbUrl],
      { shell: true },
    )
    return stdout
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const sqlString = (v) => `'${String(v).replaceAll("'", "''")}'`
const sqlJsonb = (v) => `'${JSON.stringify(v).replaceAll("'", "''")}'::jsonb`
const sqlTextArray = (arr) => `array[${arr.map(sqlString).join(', ')}]::text[]`

const EMPTY_PERSONALITY = { traits: '', ideals: '', bonds: '', flaws: '' }
const DEMO_IMAGES = {
  fullbodyUrl: '/placeholders/fullbody.png',
  avatarUrl: '/placeholders/avatar.png',
  tokenUrl: '/placeholders/token.png',
  portraitUrl: '/placeholders/portrait.png',
}

const DEMO_CHARACTERS = [
  {
    name: 'Kaelen Ashford',
    raceKey: 'srd-2024_human',
    classKey: 'srd-2024_fighter',
    backgroundKey: 'srd-2024_soldier',
    alignment: 'Lawful Good',
    abilities: { str: 15, dex: 14, con: 13, int: 12, wis: 10, cha: 8 },
    abilityBonuses: { str: 2, con: 1 },
    skillProficiencies: ['Athletics', 'Intimidation'],
    toolProficiencies: ['Choose one kind of Gaming Set'],
    hpMax: 12,
    freeformText: 'A disciplined ex-soldier seeking purpose after the war.',
    physical: { age: '29', height: "6'1\"", hair: 'Black', eyes: 'Brown', description: 'Scarred, broad-shouldered' },
    backgroundNarrative:
      'Kaelen served a decade in the border legions before the peace treaty put them out of a job. Now they take up ' +
      "the sword for coin and purpose, uneasy in a world that no longer needs soldiers but hasn't found peace either.",
  },
  {
    name: 'Wren Nightingale',
    raceKey: 'srd-2024_elf',
    classKey: 'srd-2024_wizard',
    backgroundKey: 'srd-2024_sage',
    alignment: 'Chaotic Good',
    abilities: { str: 8, dex: 13, con: 12, int: 15, wis: 14, cha: 10 },
    abilityBonuses: { con: 1, int: 1, wis: 1 },
    skillProficiencies: ['Arcana', 'History'],
    toolProficiencies: ["Calligrapher's Supplies"],
    hpMax: 7,
    freeformText: 'An archive-obsessed scholar chasing a forbidden text.',
    physical: { age: '112', height: "5'6\"", hair: 'Silver', eyes: 'Violet', description: 'Ink-stained fingers, satchel of scrolls' },
    backgroundNarrative:
      'Wren grew up among the archive-keepers of a sunken library, cataloguing texts nobody was meant to read twice. ' +
      'One of them mentioned a name that isn\'t supposed to exist anymore, and Wren has not stopped thinking about it since.',
  },
]

async function main() {
  const lookup = await runQuery(`select id from auth.users where email = ${sqlString(userEmail)};`)
  const match = /"id":\s*"([0-9a-f-]{36})"/.exec(lookup)
  if (!match) {
    console.error(`No user found with email ${userEmail}. Query output:\n${lookup}`)
    process.exit(1)
  }
  const userId = match[1]
  console.log(`Seeding demo characters for ${userEmail} (${userId})`)

  for (const c of DEMO_CHARACTERS) {
    const draft = {
      step: 'review',
      name: c.name,
      raceKey: c.raceKey,
      classKey: c.classKey,
      abilityMethod: 'standard_array',
      baseAbilities: c.abilities,
      backgroundKey: c.backgroundKey,
      abilityBonuses: c.abilityBonuses,
      skillProficiencies: c.skillProficiencies,
      toolProficiencies: c.toolProficiencies,
      equipmentChoice: 'A',
      alignment: c.alignment,
      personality: EMPTY_PERSONALITY,
      freeformText: c.freeformText,
      physical: c.physical,
      images: DEMO_IMAGES,
      backgroundNarrative: c.backgroundNarrative,
    }

    const sql = `
insert into characters (
  user_id, name, race_key, class_key, background_key, level, alignment,
  abilities, ability_bonuses, skill_proficiencies, tool_proficiencies, equipment,
  hp_max, hp_current, personality, freeform_text, physical, background_narrative,
  images, draft, is_complete
)
select
  ${sqlString(userId)}, ${sqlString(c.name)}, ${sqlString(c.raceKey)}, ${sqlString(c.classKey)}, ${sqlString(c.backgroundKey)}, 1, ${sqlString(c.alignment)},
  ${sqlJsonb(c.abilities)}, ${sqlJsonb(c.abilityBonuses)}, ${sqlTextArray(c.skillProficiencies)}, ${sqlTextArray(c.toolProficiencies)}, '[{"source":"background","choice":"A"}]'::jsonb,
  ${c.hpMax}, ${c.hpMax}, ${sqlJsonb(EMPTY_PERSONALITY)}, ${sqlString(c.freeformText)}, ${sqlJsonb(c.physical)}, ${sqlString(c.backgroundNarrative)},
  ${sqlJsonb(DEMO_IMAGES)}, ${sqlJsonb(draft)}, true
where not exists (
  select 1 from characters where user_id = ${sqlString(userId)} and name = ${sqlString(c.name)}
);`.trim()

    console.log(`Inserting ${c.name}...`)
    await runQuery(sql)
  }

  console.log('Done.')
}

main().catch((err) => {
  console.error(err.stderr ?? err.message ?? err)
  process.exitCode = 1
})
