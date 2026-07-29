# Story coherence: three layers, and the rules between them

Written 2026-07-29, after a session that fixed eight defects and found that every one of them was
the same mistake wearing different clothes.

## The invariant

The owner's framing, which everything below serves:

> The pregenerated plot and the nodes and routes the players have taken are the ground truth and
> cannot be undone. Player intent adds minor details, it shouldn't be plot breaking.

Routes are interchangeable stagings of one plot beat. They differ in flavour, in what a failure
costs, and (eventually) in which ending they steer toward. They never differ in what becomes true.

## The three layers

| layer | answers | may be written by |
|---|---|---|
| **Canon** | what is TRUE | node transitions, milestones, `applyNpcState` - nothing else |
| **Colour** | how it READS | narrator, NPC dialogue, scene ledger digest |
| **Affordance** | what the player MAY DO | derived from canon; never from colour |

Two rules hold the whole system:

1. **Colour may never write canon.** Prose describes; only structure decides.
2. **Affordance must always reflect canon.** If the player is offered it, canon must permit it.

Every defect found in this session is a violation of one or the other.

### Rule 1 violations (colour writing canon)

| defect | what happened |
|---|---|
| phantom NPCs | stage 5b prose staffed scenes with people no row existed for - six across four guides |
| ladder contradictions | a setback killed the antagonist; the next route's seed had them alive |
| Rasmund's death | narration killed an NPC; `npcStates` never learned; the ending resurrected him |
| three NPCs absent | the ledger promoted "she turns away" into a durable `absent`, deleting an objective's whole cast |

### Rule 2 violations (affordance not reflecting canon)

| defect | what happened |
|---|---|
| chips for a scene elsewhere | `openAuthoredNode` publishes the node's affordances unconditionally (line 186) and computes whether the party is even there fifty lines later (line 237), using it only to shape narration |
| engaging from the wrong place | the entry mapper opens the encounter wherever the party stands - either teleporting the conversation or killing the beat |

Rule 1 has been the focus and is now largely enforced. **Rule 2 is the open work.**

## What node placement changed, and what it did not

`1e24291` gave every node a location so the runtime could tell "the party is standing here" from
"the party has not gone there yet". It taught the NARRATOR that difference - a node elsewhere is
written as a pull, "what reaches them where they stand".

It did not teach the AFFORDANCE layer. So a scene across town still publishes "Ask Maren about the
Deep Compact" as a button, and pressing it opens the conversation regardless. The prose says the
party has not travelled; the chips say they may act as though they had.

## The missing lifecycle

A beat needs three states, and only the first two exist implicitly today.

```
            open node, party elsewhere            travel to node location
   (none) ─────────────────────────────► PULLED ─────────────────────────► PRESENT
      │                                     │                                 │
      │  open node, party already there     │  engage a scene affordance      │
      └─────────────────────────────────────┴────────────────────────────────►│
                                                                              ▼
                                                                          ENGAGED
                                                              (encounter frame owns the chips)
```

- **PULLED** - narration writes the pull. Offerable affordance: **travel there, and nothing else.**
- **PRESENT** - the node's authored affordances are offerable.
- **ENGAGED** - encounter open; the encounter frame governs, chips cleared (already true today).

The transition that does not exist is `PULLED -> PRESENT`. Travel commits `scene.locationId` and
nothing notices that an open beat's scene has become reachable, so its real chips never appear.

## Enforcement belongs at the mapper, not the chips

Chips are presentation. Players also type free text, and the entry mapper maps "I ask Maren about
the compact" onto the same affordance - so a chip-only fix is bypassable by typing.

- **Chips** express what is offerable. Presentation.
- **Entry mapper** decides what actually happens. Enforcement.

Both need the rule. Only the mapper is load-bearing.

## What exists, what is missing

Exists:
- `story_nodes.location_id` - where a scene happens (closed vocabulary, validated)
- `state.scene.locationId` - where the party is
- `npcs.itinerary` - where each character is, by objective, derived from node placement
- the narrator's `CAST ... (at X)` line - the first consumer of the itinerary

Missing:
- a travel affordance generated for a PULLED beat
- a `PULLED -> PRESENT` transition that republishes the node's affordances on arrival
- a guard in the entry mapper: engaging a scene affordance while elsewhere becomes travel, never
  an encounter open
- the same question for NPCs: "talk to Pell" is offerable only if Pell is staged here

## Build order

1. **Mapper guard.** Engaging a scene affordance while elsewhere resolves as travel. Smallest, and
   it closes the destructive path - the one that killed the Maren beat - without touching how chips
   are published.
2. **Travel affordance for PULLED beats.** Replaces the scene's chips while the party is away, so
   the player is never offered an action they cannot take.
3. **Republish on arrival.** The `PULLED -> PRESENT` transition.
4. **NPC-presence affordances.** Same rule, applied to who can be spoken to.

## Failure modes this design must not reproduce

Each of these cost a real run or a real guide:

- **Never destroy a beat to enforce a rule.** Refusing to open an encounter is fine; marking the
  beat stillborn and paying its setback for a scene nobody saw is not. That is the Maren failure.
- **Never block prose on a heuristic.** `runConsistency` was 14-for-14 false positives;
  `namesRemovedBy` read "dead set against" as a death and killed a guide after seven retries.
- **Degrade in the safe direction.** If a rule cannot decide, allow and inform. A missing gate is
  recoverable; a wrongly-fired one deletes content.
- **Derive rather than author.** A derived field cannot contradict its source. `npcs.itinerary`
  cannot disagree with node placement; an authored `npcs.location` would, the first time two stages
  disagreed.
- **Read before believing an instrument.** Four times this session the tool was wrong and the code
  was right - possessives read as unknown names, a Node-26 quirk mistaken for a CI failure, an
  audit query missing a column, a scanner matching "not dead" as a death.

---

# Current state (2026-07-29)

## Tooling — `tests/lab/`

Run these before spending anything on play. They cost nothing and have found most of the defects
recorded above.

```
node tests/lab/guide-audit.mjs <adventure_id>       # prose vs structure: names, ladder, losses, itineraries
node tests/lab/guide-dump.mjs <adventure_id>        # the whole guide in reading order
node tests/lab/transcript.mjs <adventure_id>        # a run's story, interleaved with structural events
node tests/lab/name-provenance.mjs <adv> <Name>     # which pipeline stage first wrote a name
node tests/lab/entry-audit.mjs <adv> [<adv> ...]    # where cutscene inputs went: fold rate, why, and what shape
```

`guide-audit` reports prose heuristics, not proofs. Read every finding before believing it - four
times in one session the instrument was wrong and the code was right.

## Testing strategy: cheap model first, always

Most defects in this system are PLUMBING - a call did not receive what it needed - and a cheap
model exposes those exactly as well as an expensive one. Of the eight fixed on 2026-07-29, five
were literally "the prompt was never given X":

  phantom NPCs         the roster was passed as bare names; role and description were discarded
  ladder contradiction stage 5b was never told its routes are played in sequence
  offer price drift    pendingOffer.gold was never passed to the press prompt
  no sense of place    npcs had no location at all, derived or otherwise
  scene resets         no bridge line was passed into a newly opened scene

So the order is:

1. **Run flattened and cheap** - `pin_models: true`, `model: google/gemini-2.5-flash-lite`. Ask
   only: did each call RECEIVE the right data, and did the machinery do the right thing? Encounter
   closed, guard fired, beat opened, state written.
2. **When output looks wrong, inspect the INPUT first.** Check what the prompt was handed before
   concluding the model failed. Four times in one session the instrument was wrong and the code was
   right; the equivalent trap here is blaming the model for missing information it was never given.
3. **Only then run deployed defaults** to judge PROSE - continuity of voice, whether a scene lands,
   whether the ending reads. That is the one question a cheap model genuinely cannot answer, and
   the A/B in model-routing.ts is the evidence for it.

Running expensive models while debugging plumbing costs money and, far worse, twenty minutes per
iteration. Reserve them for the final pass.

## Lab configuration that matters

- `pin_models: true` + `model: google/gemini-2.5-flash-lite` flattens every role to the cheap
  model. Use it to debug MECHANICS - did the encounter close, did the guard fire. Do not judge
  prose from a flattened run; the narrator is deliberately glm-5.2 on an A/B (model-routing.ts).
- `autocomplete_objectives: false` is the only honest setting. With it on, the harness completes
  objectives on a timer and every progression number flatters you - that is what hid the
  20-turn social stall for an entire session.
- Reuse needs an adventure with no live session. `status = guide_ready` is the reliable marker for
  "never played"; it flips to `active` on first play.
- A run costs about **$0.08 and 14 minutes** at 30 turns on flattened flash-lite. That is cheap
  enough that "measure it" is almost always the right answer - several of the open items below
  have been argued about for longer than it would take to settle them.
- The queue is SERIAL and, until 2026-07-29, could be wedged forever by a runner killed outright:
  `status` is only written by `executeRun`'s own try/catch, so a closed terminal left the row
  `running` and `claimNext` refused everything behind it (one such row blocked the queue for 69
  hours). `lab-runner.mjs` now reaps a run that is over 30 minutes old AND has written no
  `lab_run_events` for 10 minutes. Both conditions are needed: age alone cannot tell a dead run
  from a long one, and the heartbeat alone is what age cannot falsify.

## Fixed and deployed

Guide time: node outcome summaries + ladder-aware authoring; scene sketches reach the node author;
the roster carries role and description (this is what stopped six phantom NPCs); lore reveal gate
by last mention; duplicate-loss rejection; derived NPC itineraries; `npc_never_staged` lint. The
stage-7 repair loop is deleted (838 lines) - it stalled on 8 of 8 guides and never once helped.

Runtime (2026-07-29): a folded question or examination consults the location reveal gate, so asking
about the world can surface an authored clue placed in the room (`seeksInformation` in
packages/rules/src/story/asking.ts, wired at the fold branch of entry.ts); the entry mapper is told
its consecutive-fold streak, not just what it repeated; `entry_mapped` carries `mapper_entry` /
`had_offer` / `hook_kind`. Listening counts as examining - the first run carrying the predicate
folded "I listen to the conversations on the harbour steps" and it was refused.

Runtime: the `absent` state can no longer be written from prose; the narrator is told where the
cast are; a named character is not the narrator's to remove (prompt only, UNMEASURED); acting on a
scene the party has not reached travels them instead of teleporting the conversation; the offer
price travels from offer to press to payout; a new scene continues from the last one's outcome
instead of starting over; a conversation ages by turns and its ceiling is no longer skipped.

## Open, in the order I would take them

1. ~~**`fold_in` dominance.**~~ **Diagnosed and fixed at the source 2026-07-29; UNMEASURED until a
   run.** It reproduces everywhere - 76% of mapped intents fold (78 of 102 across six runs), not
   10-of-15 in one - but the cause was not the mapper misfiling and not the `offered && !spec`
   downgrade, which accounts for only 28 of the 78. **50 folds happened with a live spec on
   offer**, and reading them says why: 37% are questions about the fiction, 35% are examinations.
   The mapper is right about every one of them. The taxonomy is what has no bucket for
   investigation, so the commonest thing players do in a cutscene wrote nothing, and the Progress
   Director drove the story alone (ac78e517: 16 player intents, 9 director actions, 0 objectives
   completed - the ladder reaching `replan_beat` and `guaranteed_route` is what hid this, because
   the story kept moving).

   Fixed: a folded question or examination now consults the location reveal gate exactly as a
   successful search does (`seeksInformation` + `discoverAtLocation`), so asking can surface an
   authored clue placed in the room and score `ingredient_revealed` - already spine progress. The
   gate is unchanged and still refuses clues placed elsewhere. Also: the anti-circling guard only
   ever caught the same push worded twice, and the real stall shape is eight DIFFERENT questions
   in a row, so the mapper is now told the fold streak; and `entry_mapped` records `mapper_entry` /
   `had_offer`, because answering "the model's call or the downgrade?" needed a three-way join
   across three tables when it should have been one field.

   **Verified live in run e8a51f01** (2026-07-29, 30 turns, $0.081, 14 min): the path fires. Two
   `ingredient_revealed` events with `source: 'cutscene_inquiry'`, both from folded replies, both
   correctly placed. 2 of the 6 folded inquiries landed a clue - 33%, exactly the "roughly a third"
   the historical replay predicted, at n=6, so read that as "not contradicted" rather than
   confirmed. Fold rate was 58% against the 76% baseline and the longest streak 4 against 8, but at
   n=12 on a different adventure NEITHER IS EVIDENCE. Three or four more cheap runs settle it for
   about thirty cents; that is the cheapest real answer on this whole list.

   **Measured across 3 more runs after deploy** (44 intents): fold rate 75%, essentially unchanged
   from the 76% baseline - but that was never the target. The folds now PAY: **8 `cutscene_inquiry`
   reveals** where there were 0, from 22 inquiries, a 36% landing rate matching the 33% the
   historical replay predicted. The open item said folds were "absorbed without advancing
   anything"; roughly a third of them now advance. Streaks of 8 persist, so the fold-streak prompt
   line has NOT visibly worked - it is the one part of this still unproven.

   Still open here: 9% of folds are physical actions absorbed as colour - "I shove Rosten Vale
   aside and grab Selka's pen" during a live combat hook. Suspect the `when unsure between adhoc
   and fold_in, prefer fold_in` tiebreaker in `ENTRY_SYSTEM`. Untouched, because changing it
   trades one bias for another and wants the measurement above first.
2. **Concurrency - DIAGNOSED 2026-07-29, not yet fixed. This is the next thing to build.** See
   "The concurrency defect" below for the full trace; the short version is that the cause is one
   line, `if (kickTail(env, sessionId, ctx)) return` at the end of `runStoryProgressHead`, and the
   fix is to defer the kick to the end of the REQUEST rather than the end of the head.
3. **The affordance lifecycle, steps 2-4 above.** Chips are still published for scenes elsewhere.
4. **Node prose built around deleted NPCs.** Stage 6 removes group-NPCs and never touches the node
   labels and seeds built around them.
5. **`runConsistency` is dead code** - `canon.restrictions` is always empty, so it returns ok before
   the model call. Repair it with real propositions or delete it; advertising a fact-check that
   never runs is worse than either.

## The concurrency defect (diagnosed 2026-07-29)

### What it looks like from outside

20 pairs of narrations across seven runs land less than 9s apart - 7% of all 267 narrations, 2-5
per run, matching the original complaint. Six of the pairs are under 2s.

Attributing them needed the `prompt` field on `narration_published` (added 2026-07-28; runs before
that carry an empty prompt and 8 of the 20 are unattributable for that reason alone). Of the 12
that could be attributed:

| count | shape |
|---|---|
| 5 | beat opening <-> a `fold_in` entry narration |
| 3 | `fold_in` entry narration <-> a DIRECTOR rung |
| 1 | beat opening <-> beat opening |
| 3 | assorted, involving the climax/finale prose |

### Why it happens

`evaluateStoryProgress` splits into a deterministic head and an agent-heavy tail, and the tail runs
in a FRESH worker because `WORKER_RESOURCE_LIMIT` is a per-worker ceiling that was killing ~19% of
turns. `kickTail` fires that second worker and `runStoryProgressHead` ends with:

```ts
if (kickTail(env, sessionId, ctx)) return
```

The head returns - but **the head is not the request.** `evaluateStoryProgress` has 11 call sites,
and every one of them keeps working after it returns, with the same `env` object now carrying
`tailKicked = true`. So the caller narrates while the tail worker is already drafting the next
scene, and neither can see the other.

The 2026-07-28 session anticipated exactly this and instrumented it rather than guessing -
`publishNarration` logs a `narration_after_tail_kick` incident with the offending prompt, with the
explicit note that "WHICH call sites publish after the kick is exactly what is not known". That
question is now answered. 34 incidents across 12 adventures:

| count | offender |
|---|---|
| 12 | the DIRECTOR rung |
| 9 | the climax prose |
| 6 | encounter close |
| 3 | the final-confrontation beat |
| 4 | assorted scene opens |

And the call ordering confirms it. `director.ts:293` calls `evaluateStoryProgress` at rung >= 2,
then goes on to `resolveOpenEncounter` (313), `promoteOpening` (337), `narrationBeat` (369) and
`deliverRung` (401) - four narrating paths downstream of a kick that has already happened.
`encounters.ts:239` does the same thing before `maybeSpawnEncounter`.

### The fix, and why the existing guard is not it

`sceneAlreadyOpened` (entry.ts) already suppresses ONE case: an `offered` entry narration echoing a
beat opening from the previous turn's tail. It is gated on `entry === 'offered'`, and the largest
measured collision shape is `beat open <-> fold_in`, which that condition excludes. Do not simply
widen the condition: for `offered` the two narrations describe the same moment and dropping one is
right, but a `fold_in` narration is the answer to what the player just typed, and suppressing it
leaves their turn unanswered. Different problem, different fix.

### What was built (2026-07-29) - and what it does NOT close

Serialize, as the original note said. `runStoryProgressHead` now PARKS its tail (`parkTail` in
progress.ts) and `index.ts` fires every parked tail from a `finally`, which is the one place that
knows the request is genuinely done. A queue rather than a slot, because the edge runtime reuses
isolates and a single slot could be overwritten and silently drop a tail - and a lost tail costs a
beat re-plan and an ending score. Demo and credential-less paths still run the tail INLINE exactly
as before, so the $0 suites are untouched.

**Read the next measurement carefully, because this closes one of two races.**

- **Same-request (closed).** Turn N's own narration racing the tail turn N kicked. This was the
  whole of the 34 `narration_after_tail_kick` incidents, and that counter is the clean metric: it
  should now sit at ~0, because nothing narrates on an env after its tail is kicked.
- **Cross-request (open, and possibly slightly worse).** Turn N's tail racing turn N+1's
  narration. Those are different workers and no `env` connects them, so parking cannot help - and
  because the tail now STARTS later, it is marginally more likely to still be running when the
  next turn arrives. If the `<9s` pair count drops but not to zero, this is why.

Closing the cross-request race means holding `typing` across the tail, and that was tried and
reverted on 2026-07-21: it turned every turn arriving mid-tail into a 409 and lost 6 of 26. Do not
re-try it without a different idea. `sceneAlreadyOpened` is the existing partial mitigation and is
gated to `entry === 'offered'`.

### THE `<9s` METRIC IS INVALID ON CHEAP RUNS - read this before measuring concurrency again

Measured after the fix, 3 runs, 114 narrations:

| metric | pre-fix (6 runs) | post-fix (3 runs) |
|---|---|---|
| `narration_after_tail_kick` | 17 | **0** |
| narration pairs <9s apart | 19 / 241 (7.9%) | 11 / 114 (9.6%) |

Only the first row means anything. **The `<9s` rule assumes a narration takes 9-33s to write** -
continuity-probe.mjs says so in its own header, and that is where `CONCURRENT_S = 8` comes from.
The premise is that a line published within 8s of the previous one was *drafted before that one
existed*. On flattened flash-lite a narration takes **1.35s**, so two perfectly sequential,
causally-ordered narrations land 2-8s apart and are indistinguishable from concurrent ones. The
post-fix runs are all flash-lite; the pre-fix set is a mix of pinned and unpinned. The comparison
is confounded, and the apparent "increase" is an artifact.

Verified by reading rather than assumed, which is the only reason it was caught: both
"contradictions" the probe reported in `30e840d5` are false positives. One is
`"The old harbourmaster's office groans around you"` -> `"You wrench open the cellar door"`, which
is the party walking through a door - the probe's own header warns about exactly this and relies on
`CONCURRENT_S` to exclude it. The other quotes `"before you"` -> `"as you step forward"`, neither of
which is a location at all; it should have abstained.

So: **the concurrency fix cannot be validated on cheap runs**, and neither can the contradiction
rate. Either run deployed defaults (where narration is slow again and the 8s premise holds), or
measure something timing-independent. One already exists and is the row that moved:
`narration_after_tail_kick` is causal, not temporal, and it went to zero.

If continuity-probe is to keep working on cheap runs, `CONCURRENT_S` must be derived from the
run's measured narrator latency rather than hard-coded at 8.

Deliberately NOT chosen: a narration lock. It can stall a turn behind a dead worker, which is the
failure mode `TYPING_STALE_MS` exists to clean up after, and this system has been bitten by locked
tables twice already.

## Why a run takes 14 minutes on a "fast" model (lead, not a conclusion)

From run e8a51f01 (30 turns, flash-lite flattened, 14.0 min, $0.081):

```
session.player_intent    30 calls   mean 17.1s   max 57.3s   total 514s
session.roll_pending     10 calls   mean 14.7s   max 31.4s   total 147s
player_agent.generate    30 calls   mean  0.9s               total  28s
```

The simulated player is not the cost - it answers in under a second. The app's own turn is 17s, and
79% of the run's wall clock is spent inside `session.player_intent` and `roll_pending`.

The reason is chain length, not model speed: **154 model calls over 30 turns, 5.1 per turn**, run
sequentially, each carrying canon + roster + party profiles + memories + 12 transcript lines, plus
an embedding call per narration and a great many DB round trips. A faster model shortens each link;
it cannot shorten the chain.

Worth a look when this is picked up: `summarizer` is the single most-called role at 1.5 per turn
(46 calls, more than the narrator's 29), and it is not obvious why a turn needs one and a half
summaries.

## Measured vs assumed

Assumed, and worth proving before relying on: the narrator removal rule (prompt only, no detector);
the `CAST (at X)` line actually improving prose; the travel guard's cost in turns beyond the single
observed firing; every part of the fold fix above - the reveal-on-inquiry path, the fold-streak
line, and whether either actually moves the 76%. Re-run `entry-audit.mjs` after the next play; it
now reads `mapper_entry`/`had_offer` directly instead of reconstructing them.

Never diagnosed: "N turns were rejected by the API" (1/50, 3/31, 4/20 across runs).
