#!/usr/bin/env node
// Seeds one demo adventure (guide_ready, demo=true) with fixture guide content - a chapter,
// two objectives, two NPCs, a location with a battle map, and two endings - so the Phase 4
// scripted demo session (session function's demo_step) can drive every renderer without any
// pipeline run or LLM spend (DEVELOPMENT-PLAN SS1.3 SEED_DEMO rule). Pair it with
// seed-demo-characters.mjs for the party.
//
// Usage: node supabase/seed/seed-demo-adventure.mjs <postgres-connection-string> <user-email>

import { execFile } from 'node:child_process'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

const [dbUrl, userEmail] = process.argv.slice(2)
if (!dbUrl || !userEmail) {
  console.error('Usage: node supabase/seed/seed-demo-adventure.mjs <postgres-connection-string> <user-email>')
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

const TITLE = 'Demo: The Hollowbrook Vanishings'

const MAP = {
  imagePath: '/placeholders/map.png',
  obstacles: [
    [10, 10], [11, 10], [12, 10], [10, 11], [20, 14], [21, 14], [22, 14], [22, 15],
    [6, 20], [7, 20], [8, 20], [15, 22], [16, 22], [25, 8], [25, 9], [26, 9],
  ],
  spawns: [[4, 26], [6, 26], [8, 26], [14, 8], [18, 8]],
}

async function main() {
  const lookup = await runQuery(`select id from auth.users where email = ${sqlString(userEmail)};`)
  const match = /"id":\s*"([0-9a-f-]{36})"/.exec(lookup)
  if (!match) {
    console.error(`No user found with email ${userEmail}. Query output:\n${lookup}`)
    process.exit(1)
  }
  const userId = match[1]
  console.log(`Seeding demo adventure for ${userEmail} (${userId})`)

  const sql = `
do $$
declare
  v_adventure uuid;
  v_chapter uuid;
  v_obj1 uuid;
  v_maren uuid;
begin
  if exists (
    select 1 from adventures where creator_id = ${sqlString(userId)} and title = ${sqlString(TITLE)}
  ) then
    raise notice 'demo adventure already exists - skipping';
    return;
  end if;

  insert into adventures (
    creator_id, mode, min_players, max_players, type, plot_idea, status, title, demo, meta_loop
  ) values (
    ${sqlString(userId)}, 'assist', 1, 4, 'one_shot',
    'Villagers are vanishing from Hollowbrook at moonrise. Something under the old mill is calling them.',
    'guide_ready', ${sqlString(TITLE)}, true,
    ${sqlJsonb({
      premise: 'Villagers are vanishing from Hollowbrook at moonrise, and the trail leads below the old mill.',
      antagonist: 'The Hollow Choir',
      stakes: 'The village fades away, one dreamer at a time.',
      arc: 'Arrive, investigate, descend.',
    })}
  ) returning id into v_adventure;

  insert into chapters (adventure_id, index, title, arc_summary, status)
  values (v_adventure, 0, 'The Vanishings', 'The party reaches Hollowbrook, wins the villagers'' trust, and uncovers what sings beneath the mill.', 'active')
  returning id into v_chapter;

  -- First objective starts hidden: the entry offer gates activation (F08 SS9).
  insert into objectives (adventure_id, chapter_id, index, title, hidden_description, completion_predicates, reveal_state)
  values
    (v_adventure, v_chapter, 0, 'Find the missing boy',
     'The miller''s son sleepwalked into the mill cellar; the Choir keeps him dreaming. DM-ONLY-TRAPWORD-ALPHA.',
     ${sqlJsonb({ all: [{ fact: 'boy_found', eq: true }] })}, 'hidden')
  returning id into v_obj1;
  insert into objectives (adventure_id, chapter_id, index, title, hidden_description, completion_predicates, reveal_state)
  values
    (v_adventure, v_chapter, 1, 'Learn what the stranger wants',
     'The stranger is a deserter from the Choir wearing borrowed skin. DM-ONLY-TRAPWORD-BETA.',
     ${sqlJsonb({ all: [{ fact: 'stranger_truth', eq: true }] })}, 'hidden');

  insert into npcs (adventure_id, chapter_id, name, role, personality, faction, description, image_prompt, images)
  values
    (v_adventure, v_chapter, 'Elder Maren', 'npc',
     ${sqlJsonb({ voice: 'weary, warm', wants: 'the vanishings to stop' })}, 'Hollowbrook',
     'The village elder, holding a frightened community together.', 'elderly village leader, lantern light',
     ${sqlJsonb({ portrait: '/placeholders/portrait.png', token: '/placeholders/token.png' })})
  returning id into v_maren;
  insert into npcs (adventure_id, chapter_id, name, role, personality, faction, description, image_prompt, images)
  values
    (v_adventure, v_chapter, 'The Stranger', 'npc',
     ${sqlJsonb({ voice: 'clipped, evasive', wants: 'to reach the mill first' })}, 'Unknown',
     'A traveler who arrived the night the first villager vanished.', 'hooded traveler, rain-soaked',
     ${sqlJsonb({ portrait: '/placeholders/portrait.png', token: '/placeholders/token.png' })});

  -- Entry quest contract (F04 SS4.3): Maren's offer opens the adventure.
  insert into quest_contracts (adventure_id, chapter_id, label, giver_npc_id, is_entry, reward, stakes, objective_ids)
  values (
    v_adventure, v_chapter, 'Find the miller''s missing boy', v_maren, true,
    ${sqlJsonb({ gold_floor: 25, gold_ceiling: 60, extras: ['lodging at the inn'] })},
    'Another dreamer walks at moonrise tonight; Maren is out of time and out of villagers willing to search.',
    array[v_obj1]
  );

  insert into locations (adventure_id, chapter_id, name, description, image_prompt, background_url, map)
  values (
    v_adventure, v_chapter, 'Hollowbrook Village Square',
    'A huddle of timber houses around a well; too few lanterns are lit.',
    'village square at dusk, lanterns', '/placeholders/background.png', ${sqlJsonb(MAP)}
  );

  insert into endings (adventure_id, index, title, description, climax_summary, tone, trigger_conditions, exclusivity_group)
  values
    (v_adventure, 0, 'The Song Ended', 'The party silences the Choir and Hollowbrook wakes.',
     'A confrontation in the resonating cellar.', 'triumphant',
     ${sqlJsonb({ summary: 'Both objectives resolved for the village.', signals: [] })}, 'main'),
    (v_adventure, 1, 'The Village That Dreams', 'Hollowbrook joins the Choir, and the party barely escapes.',
     'The mill collapses inward as the song swells.', 'tragic',
     ${sqlJsonb({ summary: 'The Choir was never confronted in time.', signals: [] })}, 'main');
end $$;`.trim()

  await runQuery(sql)
  console.log('Done. Open the adventure from Home and press Start Adventure to enter the lobby.')
}

main().catch((err) => {
  console.error(err.stdout ?? '', err.stderr ?? err.message ?? err)
  process.exitCode = 1
})
