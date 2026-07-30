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

- **C1. The outcome ladder narrates its own bookkeeping.** **NOT A BUG - it was the cheap model.**
  Closed 2026-07-30. "The failure clings to you like the foundry dust" (bac9f4b9 #5) and "The first
  setback already cost you" (bc918319 #13) both came from flash-lite narration. Run e87b3506 - the
  first run with glm-5.2 in the narrator AND npc_agent seats, 30 turns - recorded **zero** hits of
  the mechanical-vocabulary guard across narration and dialogue. `mechanical-vocab.ts` is deleted.
  The lesson is about the method, not the words: shadow mode is what made the deletion provable.
  Enforcing would have hidden it, because a guard with no true positives and a guard that blocks
  nothing look identical once the suspect draft never ships.
- **C2. Prompt scaffolding published as story text.** FIXED 2026-07-29 - `stripContextEcho`.
  Was 3 of 348 lines showing players `CAST Dorya Salk - female Mirefleet resident...` with PARTY,
  SOFAR and LAST beneath. The guard fired for real in bac9f4b9 (`context_echo_stripped: 1`).
- **C3. The objective title pasted on as a closing sentence.** FIXED 2026-07-30 at the source.
  Five published passages in e87b3506 ended on the literal line "Learn why the plague bell tolls.",
  and a sixth wove "The truth in Voss's cellar waits" into mid-paragraph prose where the
  trailing-label guard cannot see it. The cause was an instruction at war with its own input: the
  narrator was handed `GOAL <objective title>` and told "never state as a task", and the cheapest
  way to satisfy "orient to this" is to say it. **Fix: the guide now authors `story_nodes.pull`** -
  one present-tense sentence naming the unresolved situation, never the task - and the narrator gets
  `PULL` instead of `GOAL`. Echoing a situation costs nothing; echoing a task breaks the fiction.
  `TRAILING_LABEL_CHECK` stays at `shadow` as a backstop, not the defence.
  Falls back to the title when unauthored, so the 23 pre-existing guides are unaffected.
  - *Not a spoiler fix.* Both leaked strings are already on the player's screen - the objective
    title in `player-sidebar.tsx` under "Current objective", the encounter label in
    `encounter-banner.tsx`. This was UI copy restated inside the fiction. See the separate open item
    on whether those titles should be spoiler-free in the first place.

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

0. **ASKING IS NOT PROGRESS - the biggest live finding, and it is not a prose bug.** Found in
   e87b3506, 2026-07-30. The party solved the mystery *correctly*, by asking, and the anti-stall
   machinery punished them for it until the scene was declared lost.

   What they did: asked what Solla said about the wind, whether the tower was locked, what the vial
   was for, what was in it, what Voss looked like, what the seal was, what the grave stakes meant.
   From the answers they learned the real plot - the bell is Voss's standing instruction to take the
   tincture, the vial has been refilled, its seal matches market apothecary goods, every grave is
   dated *after* the plague was declared over. They passed **6 of 10** checks.

   What the machinery did:

   | signal | value |
   | --- | --- |
   | `entry_mapped` | 7 of 12 -> `fold_in`, all correctly classified as asking |
   | `isSpineProgress` | counts `entry_mapped` only when `entry === 'offered'` - **fold_in is never progress** |
   | `turnsSinceProgress` | climbed 3 -> 7 while the mystery was being solved |
   | `npc_deflected` x7 | soft -> firm -> **shut x5**, same NPC |
   | `reveal_blocked` x2 | gated behind "successful DC 12 persuasion" - **while that NPC was shut** |
   | `encounter_force_failed` | reason `off_spine` |
   | `main_objective_routes_spent` | *"every authored scene was played and lost"* |

   The chain: asking is not progress -> counter climbs -> NPC shuts -> the party loses the only
   affordance that could produce progress -> the gated check becomes unrollable -> the scene is
   failed for being off-spine -> the main-objective guard force-credits the plot so the story
   survives. **The safety net caught the story. It should not have had to.**

   This is the corollary of the 2026-07-29 "asking is not acting" fix, which was correct and should
   stay: a question must not *enact* a scene. What was never applied is the other half - a
   *productive* question still has to count as motion, or a mystery is punished for being played as a
   mystery.

   **The lock is FIXED 2026-07-30** (`deflect.ts`). Two defects, both in the ladder rather than the
   counter:
   - `shut` was terminal in the literal sense - every deflection from the third onward returned it,
     for as long as the stretch lasted, and a stretch can only end when the spine moves, which `shut`
     is the main thing preventing. A nudge with no ceiling is a wall. It now fires **once** and
     settles back to `firm`.
   - A route-bearing NPC now **never hardens past `soft`** (`holdsRoute`). If the person still holds
     an undiscovered clue the current objective needs, talking to them *is* the spine, whatever the
     counter says - Rule 2 in one line. `npc_deflected` now logs `holds_route` and `prior`, so the
     next run is readable without re-deriving them: a `shut` beside `holds_route=true` means this
     regressed.

   **Still open: the counter itself.** `turnsSinceProgress` measures "did the bookkeeping change",
   not "did the party get anywhere", and those come apart exactly when a story advances by learning.
   Deliberately NOT fixed by counting inquiries: a question answered from `established` or
   `hereFeatures` is not a state change, so crediting it would let colour drive the counter, which is
   Rule 1. `ingredient_revealed` is already in `SPINE_TYPES` and is the honest signal - it fired once
   while `reveal_blocked` fired twice. **The next thing to look at is that gate**
   (`revealVerdict`, `condition && !checkPassed`): a clue gated behind a check the party cannot
   currently attempt is a place the story can stall, and the only thing that saved the run was the
   main-objective backstop. Note the early director rungs cannot help here - `nudge`, `reveal` and
   `replan` all emit narration only and credit nothing, so they never reset the counter either.

1. **Objective titles are themselves spoilers, and the sidebar shows them.** Owner call 2026-07-30:
   fix at **adventure creation (stage 3)**, not at play time. `player-sidebar.tsx` renders
   `currentObjective.title` under "Current objective", so a title like *"Find the truth in Voss's
   cellar"* tells the player there is a cellar, whose it is, and that a truth is in it - before any
   of that is discovered. That is a spoiler regardless of what the narrator does; it just arrives via
   the UI. Stage 3 should author titles that name only what the party already knows, in the same way
   `pull` is now constrained (see C3). Deliberately deferred, not dropped.

2. **Verify the decoupling live** - see "What to do next" above. It is built and deployed but two
   pieces have never executed: the `node_established` credit fix and the stage-5 split.
3. **The affordance lifecycle, steps 2-4.** Chips are still published for scenes elsewhere; the
   `PULLED -> PRESENT` transition still does not exist, so arriving never republishes a beat's real
   affordances; NPC-presence affordances untouched. Step 1 (the mapper guard) shipped and fires
   correctly - `engage_before_arrival` fired twice in 9a5f87a6.
4. **`fold_in` physical actions.** 9% of folds are real actions absorbed as colour - "I brace
   myself and draw my greataxe, stepping further into the cellar" during a live skill-challenge
   hook. Suspect the `prefer fold_in` tiebreaker in `ENTRY_SYSTEM`. Wants a measured run first.
5. **The fold-streak prompt line is HARMFUL, not merely ineffective.** Corrected 2026-07-29 after
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
6. **Node prose built around deleted NPCs.** Stage 6 removes group-NPCs and never revisits the
   labels and seeds written around them.
7. **`runConsistency` is dead - DELIBERATELY. Delete the call site; do not revive it.**
   Investigated 2026-07-30. `restrictions.push` appears **nowhere** in the codebase: the array is
   built empty and stays empty, so `runConsistency` hits its `restrictions defined && empty ->
   {ok:true}` early return on every narration and never reaches a model call.
   That is not rot. Committed world flags WERE restrictions and were demoted on evidence: across
   three paid runs it blocked 14 times and **all 14 were false**, 12 of them a draft *agreeing* with
   the flag it was accused of contradicting ("The Iron Hand scouts you felled lie unmoving amidst
   overturned crates" vs `observed iron hand scout`). The deterministic gates cannot catch that - the
   model cites a real id and does quote the draft; the bad judgement is inside them.
   So the narration path has **no canon check at all, by design**, and item 10 below is the standing
   cost of that retreat rather than an oversight. Repairing it means rebuilding the thing with the
   0-for-14 record. The answer that has actually worked is upstream: give the narrator the facts so
   it does not invent (2026-07-30 CAST identity fix). **Re-scoped from "repair or delete" to
   "delete".**

8. **THE REVEAL GATE IS THE NEXT REAL BUG - 62% of authored clues sit behind it.**
   Investigated 2026-07-30, and it is the root cause the deflection fix only guards against.
   - **339 of 544 ingredients across all adventures are condition-gated** (62%). In the e87b3506
     adventure: 7 clues, 3 gated, **0 of the 3 ever discovered**, 1 of 7 discovered in 30 turns.
   - **The condition text is never parsed.** `revealVerdict` is `candidate.condition &&
     !ctx.checkPassed` - nothing reads "successful DC 12 persuasion". The authored skill and DC are
     decorative: ANY passing check of ANY kind on the same utterance unlocks it, and no check on the
     utterance blocks it however apt the question.
   - `checkPassed` is `checkResult?.success ?? false` - the check attached to THIS utterance. So
     unlocking an authored clue needs a three-way coincidence on one turn: the player says something
     that triggers a check, passes it, AND the model asks for that specific ingredient.
   - This is what starves the progress counter. `ingredient_revealed` is in `SPINE_TYPES`, so a
     landed reveal resets the stall clock - and the main channel for authored information is mostly
     shut. Two blocked reveals in e87b3506 against one that landed.
   - Decide the direction before coding: either honour the authored condition (parse skill+DC, which
     makes it *harder* but meaningful), or drop condition-gating for clues the current objective
     needs (which makes the authored string honest by removing it). The status quo - an unparsed
     string that gates 62% of the content on an unrelated dice roll - is the one option that is
     defensible on neither reading.

9. **The offer-acceptance narration teleports the party to the quest giver.**
   Investigated 2026-07-30. `finishNegotiation` seeds the beat with a hardcoded
   `narrate ${giver}'s reaction first`, regardless of whether the giver is in the scene. In
   e87b3506 the party accepted on turn 6 from the chapel in morning light, with an utterance aimed
   at something else entirely ("I'll go up the tower and ring the bell"); Wendel Tannwright is at
   The Greyflow, so the narration dutifully rebuilt the river at dusk around him and the sequence
   became chapel(morning) -> river(dusk) -> tower with no travel. It is also the ONE narration in
   the run that published before its own turn's intent was accepted (1 of 30, measured).
   Small fix: condition that clause on the giver actually being staged.

10. **Multi-narration turns are the parked tail's bill, and the nudge-at-1 is NOT a bug.**
   Investigated 2026-07-30. 5 of 30 turns published more than one narration; turn 27 published
   three. Traced: turn 26 completed an objective and met a beat exit but did not open the next
   beat - that happened at the start of turn 27's request, and the beat's OPENING narration
   published ahead of the answer to turn 27's actual input ("I look at the gap in the wall" was
   answered second, after an unrelated boy arriving). A director nudge added the third.
   The nudge firing at "1 turns without progress" against a threshold of 2 looked like an off-by-one
   and is not: `thresholdFor` applies seeded jitter, `Math.max(1, base + jitter)`.
   This is the cost of the 2026-07-29 parked-tail fix, which was right - it took
   `narration_after_tail_kick` from 17 to 0. Deferred work has to land somewhere, and it lands at
   the head of the next request. Worth recording before anyone "fixes" the ordering and reopens the
   same-request concurrency it closed.

11. **Widen the perf instrumentation** to all queries; 50% of a request is unexplained.
12. **31% of nodes have an empty `onFailure`** - no price at all for going badly. This matters MORE
   now: since the plot advances either way, the outcome map is the only thing that distinguishes
   winning from losing, so a node with an empty failure map is a scene where losing is free.
13. **Nothing detects single-narrator canon drift** - a narrator contradicting what it established
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
