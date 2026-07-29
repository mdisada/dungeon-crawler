// Guide audit: the checks the structural gates cannot make.
//
//   node guide-audit.mjs <adventure_id>
//
// The pipeline already proves a guide FINISHABLE - lintStoryGraph gates the structure and
// prove.ts walks every path through the navigator. Both are deterministic and both pass on
// anything that ships. What neither can see is the PROSE: narration_seed, setback_line and
// label are free text, governed by nothing. Every jarring artefact read so far lives there.
//
// Checks are code-decidable on purpose (the standing lesson: model perceives, code judges).
// Anything needing judgement is printed under READ, never asserted.
import { serviceRest } from './shared.mjs'

const adv = process.argv[2]
if (!adv) throw new Error('usage: node guide-audit.mjs <adventure_id>')

const [adventure] = await serviceRest('GET', `adventures?id=eq.${adv}&select=title,meta_loop`)
const chapters = await serviceRest('GET', `chapters?adventure_id=eq.${adv}&select=id,index,title,entities`)
const ingredients = await serviceRest('GET', `ingredients?adventure_id=eq.${adv}&select=content`)
const objectives = await serviceRest(
  'GET', `objectives?adventure_id=eq.${adv}&select=id,index,title,hidden_description,reveals_lore&order=index`)
const nodes = await serviceRest(
  'GET', `story_nodes?adventure_id=eq.${adv}&select=id,objective_id,key,index,role,kind,label,narration_seed,location_id,transitions,outcome_summary,encounter_spec&order=key`)
const locations = await serviceRest('GET', `locations?adventure_id=eq.${adv}&select=id,name`)
const npcs = await serviceRest('GET', `npcs?adventure_id=eq.${adv}&select=id,name,initial_state,itinerary`)

const findings = []
const add = (severity, code, where, message) => findings.push({ severity, code, where, message })

const objById = new Map(objectives.map((o) => [o.id, o]))
const locById = new Map(locations.map((l) => [l.id, l.name]))
const lore = (adventure.meta_loop?.entities ?? []).filter((e) => e.kind === 'lore')

// Everything the guide has NAMED somewhere structural. A proper noun in prose that is not in
// here exists only in that one sentence - nothing else in the adventure knows about it.
const knownWords = new Set()
// Apostrophes are separators here, matching the possessive stripping in unknownNames - otherwise
// the location "the Harbourmaster's Office" registers "harbourmaster's" and a seed saying
// "Harbourmaster" reads as an unknown name.
const learn = (s) => String(s ?? '').split(/[^A-Za-z]+/).filter(Boolean).forEach((w) => knownWords.add(w.toLowerCase()))
npcs.forEach((n) => learn(n.name))
locations.forEach((l) => learn(l.name))
lore.forEach((e) => learn(e.name))
chapters.forEach((c) => learn(c.title))
objectives.forEach((o) => learn(o.title))
learn(adventure.title)
// CHAPTER entities, not just the global registry (2026-07-28). Stage 2 may introduce names of
// its own - they are the chapter's must-cover contract for stage 4 - and reading only
// meta_loop.entities made this check report every one of them as unregistered. "Miriam's Promise"
// was flagged as a phantom ship on guide 01d11fda when it is registered chapter-level lore AND
// materialized as an ingredient. A false positive here is expensive: it is an argument for
// blocking a guide that is fine.
chapters.forEach((c) => (c.entities ?? []).forEach((e) => learn(e.name)))
ingredients.forEach((g) => learn(g.content))

// Capitalised words that are ordinary English rather than names. Only consulted for tokens
// found mid-sentence, so sentence-initial "The"/"You" never reach it.
const COMMON = new Set([
  'i', 'you', 'your', 'the', 'a', 'an', 'and', 'but', 'or', 'if', 'as', 'at', 'by', 'for', 'from',
  'in', 'into', 'of', 'on', 'to', 'with', 'this', 'that', 'these', 'those', 'it', 'its', 'they',
  'them', 'their', 'he', 'she', 'his', 'her', 'we', 'us', 'our', 'one', 'two', 'three', 'four',
  'five', 'six', 'seven', 'eight', 'nine', 'ten', 'first', 'second', 'third', 'monday', 'tuesday',
  'wednesday', 'thursday', 'friday', 'saturday', 'sunday', 'north', 'south', 'east', 'west',
])

/** Proper-noun candidates that are NOT sentence-initial - a name the guide never registered. */
function unknownNames(text) {
  const s = String(text ?? '')
  const out = new Set()
  // Split into sentences so the first token of each is exempt (capitalised by grammar, not by name).
  for (const sentence of s.split(/(?<=[.!?])[\s"'“”]+|\n+/)) {
    // `'s` is stripped, not tokenized: "Marenref's" is the registered name Marenref wearing a
    // possessive, and reading it as an unknown word made four of this check's first nine hits
    // false. Quotes and dashes count as sentence-initial padding for the same reason - `"Step
    // aside," she commands` opens a sentence, so "Step" is grammar, not a name.
    const tokens = [...sentence.matchAll(/\b([A-Z][a-z]{2,})(?:'s)?\b/g)]
    for (const m of tokens) {
      if (sentence.slice(0, m.index).replace(/[\s"'“”—-]+/g, '') === '') continue
      const w = m[1].toLowerCase()
      if (COMMON.has(w) || knownWords.has(w)) continue
      out.add(m[1])
    }
  }
  return [...out]
}

const norm = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean)
const grams = (w, n) => new Set(w.flatMap((_, i) => (i + n <= w.length ? [w.slice(i, i + n).join(' ')] : [])))

// ---------------------------------------------------------------------------------------------
// 1. A person, place or thing that exists only in one sentence of prose.
//
// The stage-5 contract is a CLOSED VOCABULARY, but it governs `npc_keys` and `location_key` -
// the structural fields. narration_seed is free text beside them, so a seed can staff its scene
// with someone the adventure has never heard of while the node's npc list stays perfectly valid.
// Nothing downstream knows that person: they cannot speak (no npc row), hold no disposition, and
// vanish the moment the scene ends.
// ---------------------------------------------------------------------------------------------
for (const n of nodes) {
  for (const [field, text] of [['seed', n.narration_seed], ['label', n.label]]) {
    const unknown = unknownNames(text)
    if (unknown.length > 0) {
      add('error', 'prose_names_unregistered_entity', n.key,
        `${field} names ${unknown.map((u) => `"${u}"`).join(', ')} - no npc, location or lore entity by that name.`)
    }
  }
  for (const t of n.transitions ?? []) {
    const ctx = t.arrivalContext ?? t.arrival_context ?? ''
    const unknown = unknownNames(ctx)
    if (unknown.length > 0) {
      add('error', 'prose_names_unregistered_entity', n.key,
        `${t.on} setback line names ${unknown.map((u) => `"${u}"`).join(', ')} - not a registered entity.`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 1b. A SCENE BUILT AROUND SOMEONE WHO NO LONGER EXISTS.
//
// Stage 6 removes NPC rows that read as groups rather than people, and correctly reclassifies them
// to lore in both registries. What it does not do is touch node PROSE - so a label like "Present
// Warden Selk with the evidence" survives its own subject, and the narrator stages a character
// with no row, no voice and no life state. Run 15fc82be: 7 of 26 narrations staged Selk, one of
// them giving him spoken dialogue.
//
// Check 1 above cannot see this: it learns names from the registry, where Selk is still listed
// (as lore), so he reads as perfectly known. Exact, not heuristic - the removal is on the record.
// ---------------------------------------------------------------------------------------------
const reclassified = await serviceRest(
  'GET', `event_log?adventure_id=eq.${adv}&type=eq.group_npc_reclassified&select=payload`)
const removedNames = reclassified.flatMap((e) => e.payload?.removed ?? [])
for (const n of nodes) {
  for (const [field, text] of [['label', n.label], ['seed', n.narration_seed]]) {
    const hit = removedNames.filter((name) => String(text ?? '').includes(name))
    if (hit.length > 0) {
      add('error', 'prose_names_removed_npc', n.key,
        `${field} is built around ${hit.map((h) => `"${h}"`).join(', ')} - the NPC row was removed as a ` +
        'group, so nothing can stage, voice or track them, but the scene still names them.')
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 2. THE LADDER CONTRADICTION.
//
// Stage 5 asks for "genuinely different ways to achieve it" and the model writes N parallel
// alternatives - each seed opens as though the objective were still wide open. But the runtime
// ladder is DERIVED and sequential (stage5-nodes.ts): route k is reached ONLY by failing route
// k-1, carrying that node's setback_line as arrival context. So every seed after the first is
// read immediately after a line describing a loss it was not written to follow.
//
// Authoring model: parallel alternatives. Runtime model: sequential fallbacks. The seeds are
// written against the wrong one.
//
// Decidable half: the setback line asserts an irreversible change (someone dies, the thing the
// objective exists to prevent happens) and the very next node's seed proceeds as if it had not.
// ---------------------------------------------------------------------------------------------
const IRREVERSIBLE = /\b(dies|died|is dead|consumed by|completes?|completed|finishes|finished|seals?|sealed|escapes? forever|is gone|too late|arrives? too late)\b/i
const byKey = new Map(nodes.map((n) => [n.key, n]))
for (const n of nodes) {
  for (const t of n.transitions ?? []) {
    const to = t.toNodeKey ?? t.to_node_key
    const ctx = String(t.arrivalContext ?? t.arrival_context ?? '')
    if (!to || t.on === 'full') continue
    const dest = byKey.get(to)
    if (!dest) continue
    const m = ctx.match(IRREVERSIBLE)
    if (!m) continue
    // Which named entity is the setback about?
    const actors = npcs.map((p) => p.name).filter((name) => ctx.includes(name))
    const stillActing = actors.filter((name) => String(dest.narration_seed ?? '').includes(name))
    if (stillActing.length > 0) {
      add('error', 'ladder_contradiction', `${n.key} --failed--> ${to}`,
        `setback says "${m[0]}" of ${stillActing.join(', ')}, but the next seed has them acting as though it never happened.`)
    } else {
      add('warning', 'setback_asserts_irreversible', `${n.key} --failed--> ${to}`,
        `setback asserts "${m[0]}" - the destination seed was written as an independent alternative and cannot know it.`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 3. A setback that resolves the objective it is a setback FOR.
//
// The atom side of this is already governed - a node's on_failure may only spend LOCAL atoms,
// never the objective's own goal (stage5-nodes.ts learned it the hard way). The PROSE side is
// not: a setback_line may narrate exactly the defeat the objective exists to prevent, and then
// the party plays on toward a goal the fiction has already lost.
// ---------------------------------------------------------------------------------------------
for (const n of nodes) {
  const obj = objById.get(n.objective_id)
  if (!obj) continue
  const titleWords = norm(obj.title).filter((w) => w.length > 3 && !COMMON.has(w))
  for (const t of n.transitions ?? []) {
    const ctx = String(t.arrivalContext ?? t.arrival_context ?? '')
    if (t.on === 'full' || !ctx) continue
    const words = new Set(norm(ctx))
    const hits = titleWords.filter((w) => words.has(w))
    if (hits.length >= 2 && IRREVERSIBLE.test(ctx)) {
      add('warning', 'setback_narrates_objective_lost', n.key,
        `setback for "${obj.title}" reads as that objective being lost outright (${hits.join(', ')}).`)
    }
  }
}

// ---------------------------------------------------------------------------------------------
// 4. Lore answers written into scenes the party reaches before earning them.
//
// The runtime half of this is fixed (f9d4f6b withholds lore notes from the narrator), but a note
// copied into an AUTHORED seed bypasses that entirely - it is guide content, and it ships.
// ---------------------------------------------------------------------------------------------
const noteGrams = new Map()
const nameWords = new Set(lore.flatMap((e) => norm(e.name)))
for (const e of lore) {
  for (const g of grams(norm(e.note), 4)) {
    if (g.split(' ').every((w) => nameWords.has(w) || knownWords.has(w) || w.length <= 2)) continue
    noteGrams.set(g, e.name)
  }
}
for (const n of nodes) {
  const hit = [...grams(norm(n.narration_seed), 4)].find((g) => noteGrams.has(g))
  if (hit) {
    add('warning', 'lore_note_in_seed', n.key,
      `seed reproduces the DM briefing for "${noteGrams.get(hit)}" ("${hit}") - the party is told what it is playing to find out.`)
  }
}

// ---------------------------------------------------------------------------------------------
// 5. Placement sanity: a seed that plants the party somewhere the node does not happen.
// ---------------------------------------------------------------------------------------------
for (const n of nodes) {
  if (!n.location_id) continue
  const here = locById.get(n.location_id) ?? ''
  const seed = String(n.narration_seed ?? '')
  const elsewhere = locations.filter((l) => l.id !== n.location_id && seed.includes(l.name))
  if (elsewhere.length > 0 && !seed.includes(here)) {
    add('warning', 'seed_places_party_elsewhere', n.key,
      `node happens at "${here}" but the seed only ever names ${elsewhere.map((l) => `"${l.name}"`).join(', ')}.`)
  }
}

// ---------------------------------------------------------------------------------------------
// ---------------------------------------------------------------------------------------------
// 5a. A LATER ROUTE THAT OPENS AS AN ARRIVAL.
//
// Route 2 is reached ONLY by failing route 1, so by then the situation has already arrived and the
// party has already had a go at it. Guide 97364401: route 1 had the Tollweight "standing before
// the open tide-ledger", its setback said it "has finished its initial tally", and route 2 opened
// "The Tollweight has arrived... The entity begins its grim work." Finished, then begins.
//
// Milder than the dead-then-alive class - the narrator gets the setback line too and can smooth
// it - so this is a WARNING. Narrow on purpose: explicit onset phrasing only.
// ---------------------------------------------------------------------------------------------
const ONSET = /\b(has arrived|have arrived|arrives at|arrive at|begins (its|to|the)|is beginning|now begins|steps into view|appears at)\b/i
for (const n of nodes) {
  if (n.role !== 'route' || n.index === 0) continue
  const m = String(n.narration_seed ?? '').match(ONSET)
  if (m) {
    add('warning', 'later_route_opens_as_arrival', n.key,
      `route ${n.index} seed says "${m[0]}" - by here the party has already failed an earlier route, so the scene has already begun.`)
  }
}

// ---------------------------------------------------------------------------------------------
// 5b. THE BLIND SPOT. Every ladder check above reads `arrivalContext` only, so when
//     outcome_summary was added they carried on passing guides whose LOSS text held the very
//     defects they exist to catch. Guide ac78e517 audited clean with both climax routes declaring
//     "the Drowned Corpus completes its manifestation, Mirehaven silenced" - the objective lost
//     outright, twice - because that sentence lived in a field nothing here looked at.
//
//     An instrument that does not read a field cannot report on it, and a new field is exactly
//     where the new defects will be.
// ---------------------------------------------------------------------------------------------
for (const n of nodes) {
  const loss = String(n.outcome_summary?.loss ?? '')
  if (!loss) continue
  const obj = objById.get(n.objective_id)
  const dest = (n.transitions ?? []).find((t) => (t.on ?? '') !== 'full')
  const destNode = dest ? nodes.find((x) => x.key === (dest.toNodeKey ?? dest.to_node_key)) : null
  const stillActing = npcs
    .map((p) => p.name)
    .filter((name) => loss.includes(name) && String(destNode?.narration_seed ?? '').includes(name))
  if (IRREVERSIBLE.test(loss) && stillActing.length > 0) {
    add('error', 'ladder_contradiction', `${n.key} (outcome.loss)`,
      `loss says "${loss.match(IRREVERSIBLE)[0]}" of ${stillActing.join(', ')}, but the next seed has them acting.`)
  }
  if (obj) {
    const titleWords = norm(obj.title).filter((w) => w.length > 3 && !COMMON.has(w))
    const words = new Set(norm(loss))
    const hits = titleWords.filter((w) => words.has(w))
    if (hits.length >= 2 && IRREVERSIBLE.test(loss)) {
      add('error', 'loss_narrates_objective_lost', n.key,
        `outcome.loss for "${obj.title}" reads as that objective being lost outright (${hits.join(', ')}).`)
    }
  }
}
// Two routes of one objective may not cost the same thing - mirrors the stage-5 parser rule, so a
// stored guide can be checked against it without regenerating.
const lossSeen = new Map()
for (const n of nodes.filter((x) => x.role === 'route')) {
  const loss = String(n.outcome_summary?.loss ?? '').trim().toLowerCase()
  if (!loss) continue
  const fp = `${n.objective_id} ${loss}`
  if (lossSeen.has(fp)) {
    add('error', 'duplicate_loss', `${lossSeen.get(fp)} + ${n.key}`,
      'both routes declare the SAME loss - the reliable signal that the objective\'s defeat was written instead of the scene\'s cost.')
  } else lossSeen.set(fp, n.key)
}

// ---------------------------------------------------------------------------------------------
// 6. Did the guide-time fields this pipeline now authors actually land? A field that silently
//    stays null degrades to the old behaviour, which is safe but invisible - so it is reported
//    rather than left to be noticed later.
// ---------------------------------------------------------------------------------------------
const withOutcome = nodes.filter((n) => n.outcome_summary?.win || n.outcome_summary?.loss).length
if (withOutcome < nodes.length) {
  add('warning', 'outcome_summary_missing', `${nodes.length - withOutcome}/${nodes.length} nodes`,
    'nodes carry no {win, loss} - they degrade to pre-gate behaviour, and the ladder cannot be checked.')
}
const revealed = objectives.flatMap((o) => o.reveals_lore ?? [])
const unresolvedLore = lore.map((e) => e.name).filter((n) => !revealed.includes(n))
if (lore.length > 0 && unresolvedLore.length > 0) {
  add('warning', 'lore_reveal_unresolved', `${unresolvedLore.length}/${lore.length} forces`,
    `never explainable in play (stays name-only, the pre-gate default): ${unresolvedLore.join('; ')}.`)
}

// ---------------------------------------------------------------------------------------------
// 7. Guide-time NPC placement: who nobody can meet, and who travels.
// ---------------------------------------------------------------------------------------------
const stagedIds = new Set(nodes.flatMap((n) => (n.encounter_spec?.params?.npc_ids ?? [])))
const unmeetable = npcs.filter((n) =>
  n.initial_state !== 'dead' && n.initial_state !== 'absent' && !stagedIds.has(n.id))
if (unmeetable.length > 0) {
  add('warning', 'npc_never_staged', `${unmeetable.length} npc(s)`,
    `no scene stages ${unmeetable.map((n) => n.name).join(', ')} - the party can never meet them.`)
}
const withItin = npcs.filter((n) => (n.itinerary ?? []).length > 0)
if (npcs.length > 0 && withItin.length === 0) {
  add('warning', 'no_itineraries', `0/${npcs.length} npcs`,
    'no NPC has a derived itinerary - either the guide predates it or the derivation did not run.')
}
console.log('  ITINERARIES:')
for (const n of npcs) {
  const stops = (n.itinerary ?? []).map((s) => `obj${s.objectiveIndex}:${locById.get(s.locationId) ?? '?'}`)
  console.log(`    ${n.name.padEnd(18)}${stops.length ? stops.join('  ->  ') : '(unplaced)'}`)
}

const order = { error: 0, warning: 1 }
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.code.localeCompare(b.code))
console.log(`\n=== guide audit ${adv.slice(0, 8)} | ${nodes.length} nodes, ${objectives.length} objectives ===\n`)
for (const f of findings) {
  console.log(`${f.severity.toUpperCase().padEnd(7)} ${f.code.padEnd(34)} ${f.where}`)
  console.log(`        ${f.message}`)
}
const errors = findings.filter((f) => f.severity === 'error').length
console.log(`\n${errors} error(s), ${findings.length - errors} warning(s).`)
console.log('READ the findings before believing them - these are prose heuristics, not proofs.')
