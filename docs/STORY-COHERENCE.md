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

# In flight: plot facts decouple from encounter outcomes

Decided 2026-07-29 with the owner; see `DECISIONS.md` for the full entry. **This is the next thing
to build and everything else is lower priority.**

## The defect, measured

103 story nodes across 12 guides:

| | |
|---|---|
| `onSuccess` carries an atom its objective NEEDS to complete | **103 / 103 (100%)** |
| `onFailure` carries no plot-satisfying atom | **103 / 103 (100%)** |
| `onFailure` is entirely empty | 32 / 103 (31%) |

So winning the encounter *is* the plot. That contradicts the invariant directly.

Live in run 9a5f87a6: the party lost all three routes of objective 0, it was retired `failed`, and
`marcus_vances_workshop_explored` was never written - while its setbacks (`warden_suspicious`,
`obvious_clues`) all fired. **The price was recorded and the fact was not.** That asymmetry is the
whole defect, and it means the cost half already works.

`failObjective` credits NO atoms. It flips `reveal_state='completed', outcome='failed'`, activates
the next objective, and moves on. For a `main` objective that state should be unreachable.

## The build, in dependency order

1. **`objectives.kind`** (`main` | `side`) - migration, then authored at stage 3, validated on parse.
2. **`establishes` on a node** - what plot fact this beat makes true, authored at stage 5,
   SEPARATE from the outcome maps and validated against the objective's atom menu.
3. **Runtime: credit `establishes` on ANY resolution tier**, in `resolveOpenEncounter`, alongside
   the tier's outcome map.
4. **Runtime: `failObjective` never applies to a `main` objective.** Routes spent -> credit the
   completion atoms, leave the already-fired setbacks standing, narrate it as achieved the hard way.
5. **Social exits authored at guide time** (see below) - now flavour, not progression.
6. **Lint: outcome maps must not contain plot-satisfying atoms.**

**Existing guides are NOT migrated.** They carry the old coupling and are pre-decision content.
Testing this needs freshly generated guides, which also invalidates the `guide_ready` reuse pool.

## Social encounters can never be won

0 of 57 social route nodes across 23 guides have authored `params.exits`. `socialExits` reads a
field the guide pipeline has NEVER written, and `runSocialExitJudge` returns null before its model
call when the list is empty - the same dead-judge shape as `runConsistency`. Null exit ->
`exitTier(null)` -> `failed`. **Every conversation ever played was a guaranteed loss.**

Under the old coupling that was plot-breaking. Under the decision above it is a FLAVOUR bug - every
conversation reads as a defeat - still worth fixing, no longer an emergency.

---

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

1. **The decoupling build above.** Everything else waits on it.
2. **The affordance lifecycle, steps 2-4.** Chips are still published for scenes elsewhere; the
   `PULLED -> PRESENT` transition still does not exist, so arriving never republishes a beat's real
   affordances; NPC-presence affordances untouched. Step 1 (the mapper guard) shipped and fires
   correctly - `engage_before_arrival` fired twice in 9a5f87a6.
3. **`fold_in` physical actions.** 9% of folds are real actions absorbed as colour - "I brace
   myself and draw my greataxe, stepping further into the cellar" during a live skill-challenge
   hook. Suspect the `prefer fold_in` tiebreaker in `ENTRY_SYSTEM`. Wants a measured run first.
4. **The fold-streak prompt line does not work.** Streaks of 8 persist after shipping it.
5. **Node prose built around deleted NPCs.** Stage 6 removes group-NPCs and never revisits the
   labels and seeds written around them.
6. **`runConsistency` is dead code** - `canon.restrictions` is always empty, so it returns ok before
   the model call. Repair it with real propositions or delete it.
7. **Widen the perf instrumentation** to all queries; 50% of a request is unexplained.
8. **31% of nodes have an empty `onFailure`** - no price at all for going badly. A flavour gap once
   the decoupling lands.

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
