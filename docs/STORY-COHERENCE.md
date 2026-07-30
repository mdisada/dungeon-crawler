# Story coherence: the invariant, the layers, and what is in flight

Last restructured 2026-07-29. Read "In flight" and "Traps" before touching anything.

## The invariant

The owner's framing, which everything below serves:

> The pregenerated plot and the nodes and routes the players have taken are the ground truth and
> cannot be undone. Player intent adds minor details, it shouldn't be plot breaking.

Expanded 2026-07-29, and this is the sharper statement:

- **The plot is prewritten and linear, except the ending.** This is the Adventurers League model.
  A published module's Part ends with a Success/Failure box and *both* branches hand off to the
  next Part.
- **A `main` objective is a plot point rendered for the player** so they can see where the story is.
  It is not a challenge with a pass/fail. It becomes true. There is no branch where it doesn't.
- **A `side` objective is an optional thread.** It can genuinely be lost, and losing it only
  colours the story.
- **Encounters - all four kinds, social included - never change the story.** Winning or losing one
  changes narration, rewards, punishments, and which ending is steered toward. Nothing else.
- **The guide carries the coherence burden by design.** The plot is pregenerated precisely so live
  play has less room to drift. That is why guide generation always uses the strong model.

Routes are interchangeable stagings of one plot beat. They differ in flavour, in what a failure
costs, and in which ending they steer toward. **They never differ in what becomes true.**

## The three layers

| layer | answers | may be written by |
|---|---|---|
| **Canon** | what is TRUE | node transitions, milestones, `applyNpcState` - nothing else |
| **Colour** | how it READS | narrator, NPC dialogue, scene ledger digest |
| **Affordance** | what the player MAY DO | derived from canon; never from colour |

Two rules hold the whole system:

1. **Colour may never write canon.** Prose describes; only structure decides.
2. **Affordance must always reflect canon.** If the player is offered it, canon must permit it.

Rule 1 is largely enforced. Rule 2 is still the open work (see "Open", item 2).

---

# Done 2026-07-29: plot facts decoupled from encounter outcomes

Decided with the owner; full entry in `DECISIONS.md`. **Built, deployed, and NOT yet verified live -
see "What to do next".**

## What was wrong

103 story nodes across 12 guides: 103 of 103 had an `onSuccess` atom their objective NEEDED to
complete, 103 of 103 credited no plot atom on failure, and 31% credited nothing at all on failure.
Winning the encounter WAS the plot, which inverts the invariant.

Live in 9a5f87a6 the party lost all three routes of objective 0 - the social one being unwinnable by
construction - and it was retired `failed` with its plot atom never written, while every setback
fired. **The price was recorded and the fact was not.** That asymmetry meant the cost half already
worked, which is why the fix was small.

## What was built

| | |
|---|---|
| `objectives.kind` (`main` \| `side`) | migration; authored at stage 3; climax must be main |
| `story_nodes.establishes` | the objective's minimal satisfying set, DERIVED at stage 5 |
| outcome maps | demoted to flavour - `onSuccess` is now empty on new guides |
| `resolveOpenEncounter` | credits `establishes` on ANY tier, source `node_established` |
| `failObjective` | refuses to fail a `main` objective |
| stage 5 social `exits` | 2-4 per node, repaired not rejected, always a non-failure way out |
| stage 5 call shape | ONE CALL PER OBJECTIVE (was per chapter - it hit the 4000-token cap) |
| `OBJECTIVE_CREDIT_SOURCES` | `node_established` added - see the trap below |

**The trap that nearly hid all of it:** the first run after building this had a perfect guide (9/9
nodes with `establishes`, 3/3 social nodes with exits) and credited NOTHING - `established: []` on
every resolution. The spine gate in `credit.ts` only lets an allow-list of "real deed" sources
complete an objective, and `node_established` was not on it. Guide right, runtime right, tests
green, run completed, an objective even completed - and the feature was inert. Only reading
`objective_credit_blocked` in the event log found it.

**Existing guides are NOT migrated.** They carry the old coupling and are pre-decision content, so
the `guide_ready` reuse pool is useless for testing any of this - generate fresh.

## What to do next

1. **ONE run on a freshly generated guide.** Two things have never executed live: the
   `node_established` credit fix, and the per-objective stage 5 split. Check
   `encounter_resolved.established` is non-empty on a FAILED tier - that is the whole decoupling in
   one number - and that no `objective_credit_blocked` names `node_established`.
2. Optional belt-and-braces: a lint that outcome maps carry no plot-satisfying atom. Low value now,
   because stage 5 derives `onSuccess` as empty and the model cannot author it.

# Narration structure bugs - the standing catalogue

**Why this list exists.** Narration defects have felt endless because they have been fixed one
incident at a time. They are not endless; they are a CLASS. Almost every guard we have is on the
INPUT side - another clause in the prompt - and the narrator is the one component allowed to
invent. Nothing checks what it invented afterwards. Measured this session, prompt-only rules do
not hold: the fold-streak line shipped 2026-07-29 changed nothing (streaks of 8 persisted), the
"never presume travel" clause loses to the node seed sitting above it, and the narrator-removal
rule has no detector at all.

**So the rule for anything on this list: prefer a STATE COMMIT or a DETECTOR over a prompt clause.**
The three narration fixes that demonstrably worked this session all did something other than ask
nicely - `stripContextEcho` (code strips the output), the entry-echo timestamp fix (code compares
two clocks), the parked tail (code changes when a worker starts).

Each entry: what it is, hardest evidence, and whether it is a state, detector or prompt problem.

## A. Prose writes canon it is not allowed to write

- **A1. The fold path hands the narrator RAW player text and orders it made true.** ROOT CAUSE.
  The prompt that teleported the party in bac9f4b9 #2, verbatim:
  `"Carry this forward: Kestrel - what's inside. Let it actually happen and MOVE the scene with it
  - describe what changes as they act."`
  The player asked a QUESTION and the narrator was told to realise it. So it walked them through
  the foundry door.
  The entry mapper already produces a cleaned `interpretation`, and `offered` / `adhoc` both use
  it - **`fold_in` discards it and passes `${text}`**, on 76% of all turns. State never diverged
  "silently": we instructed the divergence. (An earlier draft of this entry blamed a missing
  `sceneEffects` commit. That was the symptom; committing travel would only have made the teleport
  official.)
  Downstream of this one: 18 narrations published before any travel was committed, the party
  carted out of an underground chamber "leaving Ashbridge", and a good share of A3.

- **A2. Narration re-attributes established canon.** DETECTOR.
  Run bc918319: #8 established "the lock was forced FROM OUTSIDE. Someone left minutes ago" - a
  clue. #12-13 re-attributed the forced door to Sella, the party's own ally, deleting the clue.
- **A3. Narration contradicts a fact it set itself, a few paragraphs later.** DETECTOR.
  Run bac9f4b9 #2 "Upon opening it, you find... stones and a brittle parchment" (and #3 reads it)
  vs #5 "the chest remains stubbornly closed, its true contents a mystery".
  Run 5a5e6c7f #13 "A hidden compartment reveals a more recent, damning entry" vs #14 "find no
  hidden compartments".
  **Nothing in the system detects this.** continuity-probe is location-and-concurrency only,
  `runConsistency` is dead code, `scene_location_diverged` is necessarily narrow. Largest
  unmeasured coherence risk in the app.

## B. Scenes narrated from the wrong position

- **B1. A beat opens from the story's STARTING position after the party has moved on.** STATE.
  Run bac9f4b9 #9: the quest-acceptance beat fired while the party stood at a passage deep inside
  the foundry, narrated Dermot reacting to their acceptance, and closed with "You turn towards the
  Toll House, where a stout, anxious man gestures you inside."
- **B2. An unplaced node's seed names a room the party is not in.** FIXED 2026-07-29 (d17f8c0) -
  the narrator is now told the seed may name a place they are not and to stage its content where
  they stand. Unverified live.
- **B3. Two code paths narrate the same arrival.** PROSE/PACING, not data.
  Run 5a5e6c7f #6/#7: near-identical paragraphs 20s apart. Both calls received correct and
  DIFFERENT prompts ("the encounter has concluded, the party FAILED it" vs "the persuasion check
  SUCCEEDS"), and #6 was in #7's context window. One player action emitting two full narrations is
  the residual smell.

## C. The machine speaking in the fiction's voice

- **C1. The outcome ladder narrates its own bookkeeping.** PROMPT (or strip).
  "The failure clings to you like the foundry dust" (bac9f4b9 #5); "The first setback already cost
  you... Now the second settles in" (bc918319 #13).
- **C2. Prompt scaffolding published as story text.** FIXED 2026-07-29 - `stripContextEcho`.
  Was 3 of 348 lines showing players `CAST Dorya Salk - female Mirefleet resident...` with PARTY,
  SOFAR and LAST beneath. The guard fired for real in bac9f4b9 (`context_echo_stripped: 1`).

## D. Delivery

- **D1. A truncated narration is published, then its regeneration is published too.** CODE.
  Run bac9f4b9 #15 ends mid-sentence ("The secrets") and #16 restates its opening verbatim, 10s
  later. Both reached the player.
- **D2. A player action answered with silence.** FIXED 2026-07-29 - the entry-echo guard measured
  its window from `Date.now()` instead of the player's intent and swallowed 9 of 20 turns.
- **D3. Concurrent narrations contradicting each other.** SAME-REQUEST FIXED 2026-07-29 (parked
  tail, `narration_after_tail_kick` 17 -> 0). CROSS-request (turn N's tail vs turn N+1) is open by
  design - closing it means holding `typing` across the tail, tried and reverted 2026-07-21 after
  409ing 6 of 26 turns.

## E. Length and repetition

- **E1. Off-contract length.** The brief asks 2-4 sentences; 79% of lines exceeded 400 chars in
  bc918319, mean 4.4 sentences, worst 15 sentences / 1196 chars.
- **E2. The premise is re-sold instead of advanced.** 10 of 43 lines in bc918319 restated Sella's
  stakes; four full re-explanations of the same predicament.

## The plan, in order

Ordered by (impact x certainty) / cost. The standing principle from this session: **prefer
AUTHORED DATA and a CLEANED INPUT over runtime detectors and prompt clauses.** The measured reason
is below under Traps - prompt-only rules did not hold, three times.

1. **Fold path uses the guard's `interpretation`, split by asking vs acting.** (A1. Small, root
   cause, 76% of turns.) `seeksInformation` already exists - it was built for the clue work today.
   Inquiry -> "answer from what is established; do NOT move them or change the world". Action ->
   today's "let it happen", which is correct for actions and only ever was.
2. **Tighten the guard so an inquiry can never render as movement** - no `sceneEffects` travel from
   a question, whatever the model proposes.
3. **Plumb the established record into the narrator's standing context.** (A2/A3. Wiring, no new
   authoring.) `outcome_summary` exists on every node - authored expressly as "the record every
   later scene reads instead of guessing" - and reaches only two narrow paths. The standing `DONE`
   line is de-slugged flag names instead. Send the authored sentences for RESOLVED nodes.
4. **Author location detail at guide time.** (Biggest lever on the improvisation ratio.) Locations
   carry ONE sentence (134 chars each, measured). 72% of folded player inputs are questions and
   examinations about the world, and there is nothing authored for them to read - so the narrator
   invents, and inventions are not recorded anywhere for the next turn. Author a sensory line plus
   3-5 examinable features and what each yields. This is the boxed-text-plus-features shape a
   published module actually uses, and it converts invention into lookup.
5. **Author arrival/transition text per location.** `transitions.arrivalContext` is authored but
   only for failure edges; ordinary arrival is improvised.
6. **Never publish a truncated narration.** (D1. Code, contained.) bac9f4b9 #15 ended mid-sentence
   and #16 republished its opening - both reached the player.
7. **Stop the machine narrating its own bookkeeping.** (C1.) "The failure clings to you"; "The
   first setback already cost you".
8. **Length and repetition.** (E1/E2.) Attempt only with a way to measure whether it took.
9. **A self-contradiction detector.** (A3.) Deliberately LAST: if 1-5 land, the narrator should
   rarely need to invent a fact it can later contradict. Build this only if the class survives.

**The ratio that justifies the order:** in a 30-turn run the narrator wrote **20,040 chars** while
the entire guide contains **6,933** of authored, player-facing prose - 2.9 to 1, and that is a
third of a playthrough. The guide is currently a sketch and live play does most of the writing.
Items 3-5 move that ratio; items 1-2 stop the writing that happens being ordered to change the
world.

# Traps: read before believing an instrument

Four times in one session an instrument was wrong and the code was right. These are the ones that
have actually cost time.

- **The `<9s` narration-pair metric is INVALID on cheap runs.** It assumes a narration takes 9-33s
  to write (`CONCURRENT_S = 8` in continuity-probe.mjs), so a line published within 8s "was drafted
  before the previous one existed". On flattened flash-lite a narration takes 1.35s, so two
  perfectly sequential narrations land 2-8s apart and look identical to concurrent ones. Both
  "contradictions" the probe reported in 30e840d5 were false positives - one was the party walking
  through a cellar door. If the probe is to work on cheap runs, derive `CONCURRENT_S` from the
  run's measured narrator latency instead of hard-coding it.
- **`usage_log` is keyed by ADVENTURE, not by run.** A reused adventure carries its guide-generation
  calls from days earlier. Filter by the run window or you will report 46s guide calls as per-turn
  cost. This produced a completely wrong efficiency finding before being caught.
- **Pre-placement guides make a whole layer inert.** Node placement landed mid-2026-07-28; guides
  authored before it have `location_id` NULL on EVERY node, so the travel guard, the "pull" framing
  and `scene_location_diverged` cannot fire at all. 12 of 23 guides are pre-placement, and every
  remaining `guide_ready` reuse candidate is. Check placement before trusting a run that exercises
  that layer.
- **`guide-audit` reports prose heuristics, not proofs.** Read every finding before believing it.

## Failure modes this design must not reproduce

Each of these cost a real run or a real guide:

- **Never destroy a beat to enforce a rule.** Refusing to open an encounter is fine; marking the
  beat stillborn and paying its setback for a scene nobody saw is not.
- **Never leave a player action unanswered.** The entry-echo guard swallowed 9 of 20 turns
  including "I turn to face into the black water and shout, 'I offer the phantom ships!'". A blank
  turn is worse than a duplicated description.
- **Never block prose on a heuristic.** `runConsistency` was 14-for-14 false positives.
- **Degrade in the safe direction.** If a rule cannot decide, allow and inform.
- **Derive rather than author.** A derived field cannot contradict its source.
- **Watch for gates that exclude their own case.** `sceneLocation`'s `state.encounter` gate looks
  wrong but is load-bearing: `encounterSpec` is only cleared when a NEW encounter opens, so an
  ungated lookup would report a node the party has already left. Relaxing it would have fed the
  narrator worse data than leaving it alone.

---

# Current state (2026-07-29)

## Tooling — `tests/lab/`

Free, and they have found most of the defects on record.

```
node tests/lab/guide-audit.mjs <adventure_id>       # prose vs structure: names, ladder, losses, itineraries
node tests/lab/guide-dump.mjs <adventure_id>        # the whole guide in reading order
node tests/lab/transcript.mjs <adventure_id>        # a run's story, interleaved with structural events
node tests/lab/name-provenance.mjs <adv> <Name>     # which pipeline stage first wrote a name
node tests/lab/entry-audit.mjs <adv> [<adv> ...]    # where cutscene inputs went: fold rate, why, what shape
node tests/lab/narration-audit.mjs                  # deterministic prose stats over every recorded run
node tests/lab/continuity-probe.mjs [adv]           # location contradictions (see the trap above)
```

## Testing strategy: cheap model first, always

Most defects are PLUMBING - a call did not receive what it needed - and a cheap model exposes those
exactly as well as an expensive one.

1. **Run flattened and cheap** - `pin_models: true`, `model: google/gemini-2.5-flash-lite`. Ask only:
   did each call RECEIVE the right data, and did the machinery do the right thing?
2. **When output looks wrong, inspect the INPUT first.** Check what the prompt was handed before
   concluding the model failed.
3. **Only then run deployed defaults** to judge PROSE. That is the one question a cheap model
   cannot answer.

**Guide generation is exempt** - it always uses glm-5.2 (`phase: 'guide'`), because the guide is
authored once and inherited by every session played on it. An explicit `model_map` entry still
overrides, which is how the lab pins a run.

**A PAID RUN IS A LAST RESORT** (owner direction, 2026-07-29). Do not spend one verifying an
individual change. Batch every question that genuinely needs deployed behaviour and spend ONE run
on all of them when the work is finished, deploying once at the end rather than leaving a half-live
state in between. A 30-turn run is only $0.03-$0.08 but it is 12-14 minutes of wall clock, and five
of them in a session is a slow feedback loop, not a fast one.

Verify with the free tools first and treat them as sufficient unless the question truly cannot be
answered without a live run: the `packages/rules` unit tests, `deno check` against the per-file
error baselines, read-only queries over the ~23 guides and ~20 recorded runs already on disk (most
"is this systemic?" questions are answerable from data already paid for), and the free lab
instruments listed above.

## Lab configuration that matters

- `autocomplete_objectives: false` is the only honest setting.
- Reuse needs an adventure with no live session; `status = guide_ready` marks "never played". But
  every current reuse candidate is a pre-placement, pre-decoupling guide - generate fresh instead.
- The queue is SERIAL and used to be wedgeable forever by a killed runner. `lab-runner.mjs` now
  reaps a run over 30 minutes old that has written no `lab_run_events` for 10 minutes. Both
  conditions are needed: age alone cannot tell a dead run from a long one, and the heartbeat is
  what age cannot falsify.

## Where a turn's time goes — MEASURED, and the obvious theory was wrong

Run 9a5f87a6, 40 play requests:

| | | |
|---|---|---|
| request time | 480s | 100% |
| model latency | 218s | **45%** |
| state I/O | 21s | **4%** |
| unaccounted | 241s | **50%** |

**The state-blob theory is disproven.** `adventure_state` is read ~16x and written ~6x per request
but costs 25ms and 31ms each, with ZERO write conflicts, and the blob is 21.8 KB. Moving the apply
into Postgres would buy back 4% of a turn. **Do not build it** - that is the change the
instrumentation existed to justify, and it does not.

Half the request is still unexplained. `takeStatePerf` only counts `adventure_state`; every other
query is invisible to it, as are the ~360 Realtime broadcast POSTs. Widen it rather than delete it.
`npc_agent` is the most expensive live role at 5.25s mean against the narrator's 1.79s.

## Fixed and deployed

**Guide time:** node outcome summaries + ladder-aware authoring; scene sketches reach the node
author; the roster carries role and description (this stopped six phantom NPCs); lore reveal gate by
last mention; duplicate-loss rejection; derived NPC itineraries; `npc_never_staged` lint; node
placement (`location_id`, mid-2026-07-28). The stage-7 repair loop is deleted (838 lines) - it
stalled on 8 of 8 guides and never once helped.

**Runtime:** the `absent` state can no longer be written from prose; the narrator is told where the
cast are; acting on a scene the party has not reached travels them instead of teleporting the
conversation; the offer price travels from offer to press to payout; a new scene continues from the
last one's outcome; a conversation ages by turns and its ceiling is no longer skipped.

**2026-07-29:**

- Asking or examining consults the location reveal gate, so a folded question can surface an
  authored clue placed in the room (`seeksInformation` + `discoverAtLocation`). Verified: 8 reveals
  across 3 runs, 36% landing rate. Listening counts as examining.
- The entry mapper is told its consecutive-fold streak; `entry_mapped` carries `mapper_entry` /
  `had_offer` / `hook_kind`.
- **The tail starts when the request stops talking.** `runStoryProgressHead` parks its tail and
  `index.ts` fires it from a `finally`. Verified: `narration_after_tail_kick` 17 -> 0.
  The CROSS-request race (turn N's tail vs turn N+1) is still open by design - closing it means
  holding `typing` across the tail, tried and reverted 2026-07-21 after 409ing 6 of 26 turns.
- **The entry-echo guard measures from the player's intent, not from `Date.now()`.** It was
  swallowing 9 of 20 turns. Verified: 0 of 1.
- **An unplaced node's seed no longer contradicts the placement guard.** The narrator is told the
  seed may name a room the party is not in and to stage its content where they actually stand.
- **`stripContextEcho`** removes briefing labels (CAST/PARTY/SOFAR/GOAL) the narrator copies into
  its own output - 3 of 348 lines did. Shipped but UNEXERCISED in a run; only its unit tests, which
  carry the real leak verbatim, are evidence.

## Open, in the order I would take them

1. **Verify the decoupling live** - see "What to do next" above. It is built and deployed but two
   pieces have never executed: the `node_established` credit fix and the stage-5 split.
2. **The affordance lifecycle, steps 2-4.** Chips are still published for scenes elsewhere; the
   `PULLED -> PRESENT` transition still does not exist, so arriving never republishes a beat's real
   affordances; NPC-presence affordances untouched. Step 1 (the mapper guard) shipped and fires
   correctly - `engage_before_arrival` fired twice in 9a5f87a6.
3. **`fold_in` physical actions.** 9% of folds are real actions absorbed as colour - "I brace
   myself and draw my greataxe, stepping further into the cellar" during a live skill-challenge
   hook. Suspect the `prefer fold_in` tiebreaker in `ENTRY_SYSTEM`. Wants a measured run first.
4. **The fold-streak prompt line is HARMFUL, not merely ineffective.** Corrected 2026-07-29 after
   reading run abd318e1. It fires at >=3 consecutive folds and tells the mapper "if this one
   reaches for anything at all, it is engagement". Streaks of 8 still persisted, so it was first
   recorded here as "does not work" - wrong. It works, and what it does is push QUESTIONS into the
   `offered` branch, where none of the asking-vs-acting protections run (those live inside
   `fold_in`).
   Live: 11 of 12 intents folded correctly, and the single outlier was "What was in the slips of
   paper?" arriving after SEVEN consecutive folds - classified `offered` by the model itself
   (`mapper_entry=offered`, no affordance match), opening a social encounter, so the NPC answered
   her own authored beat instead of the question. One turn earlier the near-identical "What do the
   slips of paper in the leather case say?" folded correctly.
   Compounded by the mapper's standing bias, `"When unsure between offered and fold_in, prefer
   offered"` - the nudge lands on a scale already tipped.
   Two fixes: the streak line should say an ACTION that reaches for something is engagement while a
   question stays a question (conditional text we already control), and `seeksInformation` should be
   consulted BEFORE the branch so an unambiguous question cannot be labelled `offered` under any
   prompt pressure. The chip path must stay exempt - clicking "ask her about Pol" IS engagement.
   Worth questioning whether the nudge earns its place at all: seven folds in a row happened
   because the player was investigating a room we had just given five authored features to
   investigate, which is the system working.
5. **Node prose built around deleted NPCs.** Stage 6 removes group-NPCs and never revisits the
   labels and seeds written around them.
6. **`runConsistency` is dead code** - `canon.restrictions` is always empty, so it returns ok before
   the model call. Repair it with real propositions or delete it.
7. **Widen the perf instrumentation** to all queries; 50% of a request is unexplained.
8. **31% of nodes have an empty `onFailure`** - no price at all for going badly. This matters MORE
   now: since the plot advances either way, the outcome map is the only thing that distinguishes
   winning from losing, so a node with an empty failure map is a scene where losing is free.
9. **Nothing detects single-narrator canon drift** - a narrator contradicting what it established
   four paragraphs earlier. Seen live in bc918319 (a forced door re-attributed from an unknown
   intruder to an ally, destroying a clue) and 5a5e6c7f (a hidden compartment found, then "no
   hidden compartments" one turn later). The continuity probe is location-and-concurrency only,
   `runConsistency` is dead, and `scene_location_diverged` is necessarily narrow. **This is the
   largest unmeasured coherence risk in the system.**

## Measured vs assumed

Assumed, and worth proving: the narrator removal rule (prompt only, no detector); the `CAST (at X)`
line improving prose; `stripContextEcho` in a live run; whether the fold fix moves anything beyond
the reveal count.

Never diagnosed: "N turns were rejected by the API" (1/50, 3/31, 4/20, 1/30 across runs).

No instrument catches SINGLE-narrator canon drift - a narrator contradicting what it established
four paragraphs earlier. Seen live in bc918319 (a forced door re-attributed from an unknown
intruder to an ally, destroying a clue) and 5a5e6c7f (a hidden compartment found, then "no hidden
compartments" one turn later). The continuity probe is location-and-concurrency only,
`runConsistency` is dead, and `scene_location_diverged` is necessarily narrow. This is the largest
unmeasured coherence risk in the system.
