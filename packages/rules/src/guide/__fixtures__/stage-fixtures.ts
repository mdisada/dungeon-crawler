// Recorded-style LLM responses for the stage parsers (F04 AI-TEST: "schema-conformance tests
// per pipeline stage (mocked LLM with recorded fixtures)"). Shapes mirror real deepseek-style
// output: code fences, preamble chatter, and all - the parsers must cope.

import type { Stage2Context } from '../stages/stage2.ts'
import type { Stage3Context } from '../stages/stage3.ts'
import type { Stage4Context } from '../stages/stage4.ts'
import type { Stage5Context } from '../stages/stage5.ts'
import type { GuideDigest } from '../stages/stage6.ts'
import type { AdventureSeed } from '../types.ts'

export const SEED: AdventureSeed = {
  plotIdea: 'A drowned god stirs beneath the harbor town of Saltmere; the tide has stopped turning.',
  mode: 'assist',
  type: 'multi_chapter',
  chaptersMin: 2,
  chaptersMax: 3,
  minPlayers: 2,
  maxPlayers: 4,
  difficultyPreset: 'standard',
}

export const SOLO_SEED: AdventureSeed = { ...SEED, minPlayers: 1, maxPlayers: 1 }

export const STAGE1_RESPONSE = `\`\`\`json
{
  "meta_loop": {
    "premise": "The tide around Saltmere has frozen mid-ebb because the drowned god Ulmoth is being woken by a cult of salvagers.",
    "antagonist": "Mother Brine, a salvager-priest who believes waking Ulmoth will return her drowned family.",
    "stakes": "If the third bell is rung beneath the harbor, Ulmoth wakes and Saltmere joins him under the water.",
    "arc": "Chapter 1: the cult secures the first two bells. Chapter 2: the party traces the stopped tide to the sunken chapel and confronts Mother Brine before the third bell rings."
  },
  "ending_premises": [
    "The bells are silenced and Mother Brine dies still calling her family's names.",
    "The party convinces Mother Brine her family would not want this; she drowns the third bell herself.",
    "The third bell rings - Saltmere floods, but the party evacuates the town in time."
  ],
  "entities": [
    { "kind": "npc", "name": "Mother Brine", "note": "salvager-priest antagonist" },
    { "kind": "npc", "name": "Harbormaster Quill", "note": "paid-off record keeper" },
    { "kind": "location", "name": "The Sunken Chapel", "note": "where the third bell lies" }
  ],
  "chapters": [
    { "title": "The Still Tide", "arc_summary": "Saltmere's fishing fleet is beached and the town blames storm-omens. In truth Mother Brine's salvagers have already raised two of the three Drowning Bells from the harbor floor. The party is drawn in when a salvager washes up half-mad, whispering about bells. The chapter really tracks the cult moving the bells to the sunken chapel while keeping the town's suspicion pointed at the sea itself." },
    { "title": "The Third Bell", "arc_summary": "The party descends to the sunken chapel beneath the harbor. Mother Brine needs one final tide-locked night to raise the third bell. Everything in this chapter is a countdown: the cult's chant grows through the water, and the finale is stopping the third ringing - by violence, by drowning the bell in silence-weed, or by convincing Mother Brine her family would not want this." }
  ]
}
\`\`\``

export const STAGE1_RESPONSE_TOO_MANY_CHAPTERS = JSON.stringify({
  meta_loop: { premise: 'p', antagonist: 'a', stakes: 's', arc: 'arc' },
  ending_premises: ['ending one', 'ending two'],
  entities: [{ kind: 'npc', name: 'A', note: 'antagonist' }],
  chapters: [
    { title: 'One', arc_summary: 'x' },
    { title: 'Two', arc_summary: 'x' },
    { title: 'Three', arc_summary: 'x' },
    { title: 'Four', arc_summary: 'x' },
  ],
})

export const STAGE2_CONTEXT: Stage2Context = {
  metaLoop: {
    premise: 'The tide around Saltmere has frozen mid-ebb.',
    antagonist: 'Mother Brine, a salvager-priest.',
    stakes: 'The third bell wakes Ulmoth.',
    arc: 'Bells one and two, then the chapel.',
    entities: [
      { kind: 'npc', name: 'Mother Brine', note: 'salvager-priest antagonist' },
      { kind: 'location', name: 'The Sunken Chapel', note: 'where the third bell lies' },
    ],
  },
  chapters: [
    { title: 'The Still Tide', arcSummary: 'The cult has raised two bells; the town blames omens.' },
    { title: 'The Third Bell', arcSummary: 'Countdown in the sunken chapel.' },
  ],
  chapterIndex: 0,
}

export const STAGE2_RESPONSE = `Here is the scene breakdown:
{
  "scenes": [
    { "sketch": "The beached fleet: fishers argue on the dry harbor floor while Harbormaster Quill quietly pays salvagers to work at night. A washed-up salvager, Tam, raves about bells under the water. The party can learn the tide stopped exactly nine days ago." },
    { "sketch": "The Brinehouse tavern: Mother Brine holds court as a beloved grief-counselor for drowned sailors' families. She recruits the desperate. Anyone asking about Tam gets gently redirected; anyone pressing gets marked for the cult's attention." },
    { "sketch": "The night dive: salvagers ferry the second Drowning Bell across the harbor floor under lantern light. A party that watches learns the route to the sunken chapel; a party that intervenes can seize the bell but reveals itself to Mother Brine." },
    { "sketch": "Quill's ledger: the harbormaster's office holds payment records tying the salvage crews to Brine and a tide-chart showing the next tide-locked night. Quill will trade the ledger for protection from the cult." }
  ],
  "entities": [
    { "kind": "npc", "name": "Mother Brine", "note": "salvager-priest antagonist" },
    { "kind": "npc", "name": "Harbormaster Quill", "note": "harbormaster paid to look away" },
    { "kind": "npc", "name": "Tam", "note": "half-mad salvager who heard the bell" },
    { "kind": "location", "name": "The Dry Harbor", "note": "harbor floor exposed by the stopped tide" },
    { "kind": "location", "name": "The Brinehouse", "note": "tavern grief-house Brine runs" }
  ]
}`

export const STAGE3_CONTEXT: Stage3Context = {
  metaLoop: STAGE2_CONTEXT.metaLoop,
  chapter: STAGE2_CONTEXT.chapters[0],
  chapterNumber: 1,
  scenes: [
    { sketch: 'The beached fleet and Tam the mad salvager.' },
    { sketch: 'The Brinehouse tavern and Mother Brine.' },
    { sketch: 'The night dive moving the second bell.' },
    { sketch: "Quill's ledger and the tide-chart." },
  ],
}

export const STAGE3_RESPONSE = `\`\`\`json
{
  "objectives": [
    {
      "title": "Learn why the tide stopped",
      "hidden_description": "The visible mystery. Tam's ravings, the nine-day timeline, and the night salvage all point to the Drowning Bells. Completes when the party connects the stopped tide to the bells rather than to weather or omens.",
      "completion_predicates": { "any": [ { "flag": "bells_connected_to_tide", "eq": true }, { "event": "party observed the night dive" } ] }
    },
    {
      "title": "Find the salvagers' route",
      "hidden_description": "The route to the sunken chapel is the chapter's real prize; Brine's crews cross the harbor floor only on tide-locked nights. Grounded in the night-dive scene and Quill's tide-chart.",
      "completion_predicates": { "any": [ { "flag": "chapel_route_known", "eq": true }, { "fact": "item.quill_ledger.holder", "eq": "party" } ] }
    },
    {
      "title": "Deal with Mother Brine",
      "hidden_description": "Not a kill order - Brine is beloved and killing her openly turns Saltmere hostile. The chapter ends when the party has committed to a stance: exposed her, allied with her, or been marked by the cult.",
      "completion_predicates": { "fact": "npc.mother_brine.stance_toward_party", "in": ["exposed", "allied", "hostile"] }
    }
  ]
}
\`\`\``

export const STAGE3_RESPONSE_BAD = JSON.stringify({
  objectives: [
    {
      title: 'Learn the entire truth about the frozen harbor tide',
      hidden_description: 'Title is too long and the predicate below is malformed.',
      completion_predicates: { fact: 'x' },
    },
  ],
})

export const STAGE4_CONTEXT: Stage4Context = {
  seed: SEED,
  metaLoop: STAGE2_CONTEXT.metaLoop,
  chapter: STAGE2_CONTEXT.chapters[0],
  chapterNumber: 1,
  scenes: STAGE3_CONTEXT.scenes,
  objectives: [
    { title: 'Learn why the tide stopped', hiddenDescription: 'Connect tide to bells.', completionPredicates: null },
    { title: "Find the salvagers' route", hiddenDescription: 'Route to the chapel.', completionPredicates: null },
    { title: 'Deal with Mother Brine', hiddenDescription: 'Commit to a stance.', completionPredicates: null },
  ],
  requiredEntities: [
    { kind: 'npc', name: 'Mother Brine', note: 'salvager-priest antagonist' },
    { kind: 'npc', name: 'Harbormaster Quill', note: 'harbormaster paid to look away' },
    { kind: 'location', name: 'The Dry Harbor', note: 'harbor floor exposed by the stopped tide' },
    { kind: 'location', name: 'The Brinehouse', note: 'tavern grief-house Brine runs' },
  ],
  existingNpcs: [],
  existingLocations: [],
}

export const STAGE4_RESPONSE = JSON.stringify({
  npcs: [
    { key: 'npc:mother-brine', name: 'Mother Brine', role: 'boss', personality: { traits: 'gentle, implacable', voice: 'low, tidal cadence', wants: 'her family back from the sea' }, faction: 'Bell Salvagers', description: 'A grief-counselor priest whose kindness is entirely real and entirely in service of drowning the town.', image_prompt: 'weathered woman in salt-crusted priest robes holding a small bronze bell', combat: { cr: '4', archetype: 'caster', skills: ['Religion', 'Persuasion'], attack: 'Tidecaller Staff' } },
    { key: 'npc:harbormaster-quill', name: 'Harbormaster Quill', role: 'npc', personality: { traits: 'nervous, meticulous', voice: 'clipped', wants: 'to survive his own complicity' }, faction: 'Saltmere town', description: 'Paid to look away; keeps records because records are the only thing he trusts.', image_prompt: 'thin harbormaster at a cluttered desk of tide charts', combat: { cr: '1/8', archetype: 'minion' } },
    { key: 'npc:tam', name: 'Tam', role: 'npc', personality: { traits: 'shattered, earnest', voice: 'whispering', wants: 'someone to believe him' }, faction: '', description: 'The salvager who heard the second bell ring underwater and lived.', image_prompt: 'soaked young salvager wrapped in a blanket, wild-eyed', combat: { cr: '1/4', archetype: 'skirmisher', skills: ['Athletics'] } },
  ],
  locations: [
    { key: 'loc:dry-harbor', name: 'The Dry Harbor', description: 'A harbor floor exposed by the stopped tide, boats leaning in the mud.', image_prompt: 'fishing boats stranded on cracked seabed under grey sky' },
    { key: 'loc:brinehouse', name: 'The Brinehouse', description: "Tavern and grief-house where Mother Brine counsels the drowned sailors' families.", image_prompt: 'candlelit tavern hung with nets and memorial ribbons' },
  ],
  coop_sets: [
    { key: 'coop:bell-truth', kind: 'split_knowledge', reveals: 'The tide is held by two raised Drowning Bells, and the third lies beneath the sunken chapel - ring it and Saltmere drowns.' },
  ],
  ingredients: [
    { type: 'clue', content: { text: "Tam's salvage tally: two bells raised, marked with tide-locked dates." }, placement: { npc_key: 'npc:tam' }, reveals: 'Two bells are already up.', pillar_tags: ['social'], reveals_to: { skill: 'insight' }, coop_set_key: 'coop:bell-truth', objective_numbers: [1] },
    { type: 'clue', content: { text: 'A hymn fragment in the Brinehouse ledger matching the Rite of the Third Ringing.' }, placement: { location_key: 'loc:brinehouse' }, reveals: 'The rite needs a third bell.', pillar_tags: ['exploration'], reveals_to: { skill: 'religion' }, coop_set_key: 'coop:bell-truth', objective_numbers: [1, 3] },
    { type: 'secret', content: { text: "Quill's ledger names every salvager Brine has paid, and the route they pole across the harbor floor." }, placement: { npc_key: 'npc:harbormaster-quill', condition: 'protection promised' }, reveals: 'The chapel route.', pillar_tags: ['social', 'exploration'], reveals_to: null, coop_set_key: null, objective_numbers: [2] },
    { type: 'event', content: { text: 'On the next tide-locked night, the salvage crew moves the second bell - observable from the breakwater.' }, placement: { location_key: 'loc:dry-harbor' }, reveals: 'The route, the hard way.', pillar_tags: ['exploration', 'combat'], reveals_to: null, coop_set_key: null, objective_numbers: [1, 2] },
    { type: 'item', content: { text: "A sprig of silence-weed in Tam's pocket - it deadens sound underwater." }, placement: { npc_key: 'npc:tam' }, reveals: 'A non-violent way to stop a bell.', pillar_tags: ['exploration'], reveals_to: null, coop_set_key: null, objective_numbers: [3] },
    { type: 'rumor', content: { text: 'Grieving families say Mother Brine can make you hear a lost voice in a seashell.' }, placement: { location_key: 'loc:brinehouse' }, reveals: 'How Brine recruits.', pillar_tags: ['social'], reveals_to: null, coop_set_key: null, objective_numbers: [3] },
  ],
})

export const STAGE5_CONTEXT: Stage5Context = {
  chapter: STAGE2_CONTEXT.chapters[0],
  chapterNumber: 1,
  objectives: STAGE4_CONTEXT.objectives,
  npcs: [
    { key: 'npc:mother-brine', name: 'Mother Brine', role: 'boss' },
    { key: 'npc:harbormaster-quill', name: 'Harbormaster Quill', role: 'npc' },
  ],
  locations: [
    { key: 'loc:dry-harbor', name: 'The Dry Harbor' },
    { key: 'loc:brinehouse', name: 'The Brinehouse' },
  ],
  difficultyPreset: 'standard',
  partyLevel: 1,
  partySize: 3,
}

export const STAGE5_RESPONSE = JSON.stringify({
  encounters: [
    { type: 'battle', objective_number: 2, location_key: 'loc:dry-harbor', summary: 'Salvage crew defends the bell sledge on the open harbor floor; lantern light and mud hazards.', enemies: [{ name: 'Cult Salvager', cr: '1/8', count: 4 }] },
    { type: 'social', objective_number: 3, location_key: 'loc:brinehouse', summary: 'A public audience with Mother Brine in front of grieving families - exposing her without proof turns the room.' },
    { type: 'environment', objective_number: 1, location_key: 'loc:dry-harbor', summary: 'Crossing the exposed harbor floor at night: mudpits, a stranded reef-eel, and the tide that could return at any moment.' },
  ],
  boss_updates: [
    { npc_key: 'npc:mother-brine', tactics_profile: { opening: 'talks first, always', priorities: 'protect the bells, convert not kill', retreat: 'slips into water when bloodied' }, boss_phases: [{ threshold: 0.5, behavior: 'calls drowned spirits' }, { threshold: 0.2, behavior: 'rings the second bell for a tide surge' }] },
  ],
})

export function buildTestDigest(): GuideDigest {
  return {
    objectives: new Map([
      ['obj#1', 'Learn why the tide stopped (ch 1)'],
      ['obj#2', "Find the salvagers' route (ch 1)"],
      ['obj#3', 'Deal with Mother Brine (ch 1)'],
    ]),
    npcs: new Map([
      ['npc#1', 'Mother Brine (boss): salvager-priest waking Ulmoth'],
      ['npc#2', 'Harbormaster Quill: paid-off record keeper'],
    ]),
    locations: new Map([
      ['loc#1', 'The Dry Harbor'],
      ['loc#2', 'The Brinehouse'],
    ]),
    ingredients: new Map([
      ['ing#1', "clue: Tam's salvage tally"],
      ['ing#2', "secret: Quill's ledger"],
    ]),
  }
}

export const STAGE6_RESPONSE = JSON.stringify({
  hooks: [
    { from: 'npc#2', to_objective: 'obj#2', hook_text: 'Quill keeps glancing at his locked ledger drawer whenever salvage pay is mentioned.', kind: 'npc_objective' },
    { from: 'ing#1', to_objective: 'obj#1', hook_text: "Tam's tally dates line up with the two nights the tide shuddered.", kind: 'location_placement' },
    { from: null, to_objective: 'obj#3', hook_text: "A character who has lost someone to the sea gets Mother Brine's genuine, dangerous sympathy.", kind: 'backstory_slot' },
  ],
})

export const STAGE7_RESPONSE = JSON.stringify({
  warnings: [
    { target: 'obj#2', message: 'The chapel route is required by chapter 2 but nothing prevents the party from skipping it if they seize the bell during the night dive.' },
    { target: 'npc#999', message: 'Handle does not exist; this warning should degrade to guide-level.' },
  ],
})

export const STAGE8_CONTEXT = {
  metaLoop: {
    ...STAGE2_CONTEXT.metaLoop,
    endingPremises: [
      'Mother Brine dies still calling her family.',
      'Mother Brine drowns the third bell herself.',
      'Saltmere floods but the town escapes.',
    ],
  },
  chapters: STAGE2_CONTEXT.chapters.map((ch) => ({ title: ch.title, arcSummary: ch.arcSummary })),
  // Objectives 1-3, NPCs 1-2 - the numbering STAGE8_RESPONSE's signals reference.
  objectives: [
    { chapterNumber: 1, title: 'Learn why the tide stopped', hiddenDescription: 'Connect tide to bells.' },
    { chapterNumber: 1, title: 'Deal with Mother Brine', hiddenDescription: 'Commit to a stance.' },
    { chapterNumber: 2, title: 'Silence the third bell', hiddenDescription: 'The finale.' },
  ],
  npcs: [
    { name: 'Mother Brine', role: 'boss' as const },
    { name: 'Harbormaster Quill', role: 'npc' as const },
  ],
}

export const STAGE8_OBJECTIVE_COUNT = STAGE8_CONTEXT.objectives.length
export const STAGE8_NPC_COUNT = STAGE8_CONTEXT.npcs.length

export const STAGE8_RESPONSE = JSON.stringify({
  dials: [
    { key: 'mercy', name: 'Mercy vs. ruthlessness', description: 'Rises when the party spares or reasons with the cult; falls when they kill.' },
    { key: 'town_warned', name: 'How much the town knows', description: 'Rises as the party spreads the truth about the bells.' },
  ],
  endings: [
    {
      title: 'The Last Ringing Silenced',
      description: 'The party stops the rite by force; Mother Brine dies beneath the chapel, and the tide returns with the dawn.',
      climax_summary: 'A running battle across the flooded nave while the chant crescendos; the bell is smothered as Brine falls.',
      tone: 'pyrrhic',
      trigger_conditions: {
        summary: 'Confrontational play: the party treats the cult as an enemy to be destroyed.',
        signals: [
          { when: { npc: 1, state: 'dead' }, weight: 4, note: 'Brine killed locks the violent path' },
          { when: { objective: 3, outcome: 'completed' }, weight: 2, note: 'the third bell dealt with' },
          { when: { dial: 'mercy', gte: 3 }, weight: -4, note: 'a merciful trajectory argues against a kill' },
        ],
      },
      exclusivity_group: 'main',
    },
    {
      title: 'Grief Answered',
      description: 'The party reaches the woman under the priest; Brine drowns the third bell herself and the cult dissolves into mourning.',
      climax_summary: 'No battle - a held breath in the chapel while Brine listens to her own hymn sung back to her, then lets the bell sink.',
      tone: 'bittersweet',
      trigger_conditions: {
        summary: 'Empathic play: the party engages Brine as a grieving person, not a monster.',
        signals: [
          { when: { npc: 1, state: 'allied' }, weight: 4, note: 'the redemption route needs her trust' },
          { when: { dial: 'mercy', gte: 2 }, weight: 3, note: 'a merciful trajectory' },
        ],
      },
      exclusivity_group: 'main',
    },
    {
      title: 'The Drowned Dawn',
      description: 'The third bell rings. Saltmere is lost to the sea - but the party\'s warning empties the town first, and Ulmoth wakes to an empty offering.',
      climax_summary: 'A desperate evacuation intercut with the rite completing; the finale is a rooftop count of who made it out.',
      tone: 'tragic',
      trigger_conditions: {
        summary: 'The party prioritizes the town over stopping the rite, or moves too slowly.',
        signals: [
          { when: { dial: 'town_warned', gte: 3 }, weight: 3, note: 'they chose the people over the bell' },
          { when: { objective: 3, outcome: 'completed' }, weight: -3, note: 'a silenced bell prevents the flood' },
        ],
      },
      exclusivity_group: 'main',
    },
  ],
})
