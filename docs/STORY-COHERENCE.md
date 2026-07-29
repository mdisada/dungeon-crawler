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
```

`guide-audit` reports prose heuristics, not proofs. Read every finding before believing it - four
times in one session the instrument was wrong and the code was right.

## Lab configuration that matters

- `pin_models: true` + `model: google/gemini-2.5-flash-lite` flattens every role to the cheap
  model. Use it to debug MECHANICS - did the encounter close, did the guard fire. Do not judge
  prose from a flattened run; the narrator is deliberately glm-5.2 on an A/B (model-routing.ts).
- `autocomplete_objectives: false` is the only honest setting. With it on, the harness completes
  objectives on a timer and every progression number flatters you - that is what hid the
  20-turn social stall for an entire session.
- Reuse needs an adventure with no live session. `status = guide_ready` is the reliable marker for
  "never played"; it flips to `active` on first play.

## Fixed and deployed

Guide time: node outcome summaries + ladder-aware authoring; scene sketches reach the node author;
the roster carries role and description (this is what stopped six phantom NPCs); lore reveal gate
by last mention; duplicate-loss rejection; derived NPC itineraries; `npc_never_staged` lint. The
stage-7 repair loop is deleted (838 lines) - it stalled on 8 of 8 guides and never once helped.

Runtime: the `absent` state can no longer be written from prose; the narrator is told where the
cast are; a named character is not the narrator's to remove (prompt only, UNMEASURED); acting on a
scene the party has not reached travels them instead of teleporting the conversation; the offer
price travels from offer to press to payout; a new scene continues from the last one's outcome
instead of starting over; a conversation ages by turns and its ceiling is no longer skipped.

## Open, in the order I would take them

1. **`fold_in` dominance.** 10 of 15 mapped intents were absorbed without advancing anything. Pure
   investigation, no paid runs, and it is the progression bottleneck.
2. **Concurrency.** 2-5 narrations per run land under 9s apart and contradict each other. The last
   piece of the original complaint. Serialize FIRST - a faster model narrows the collision window
   without closing it - then use authored transitions to precompute the likely next opening.
3. **The affordance lifecycle, steps 2-4 above.** Chips are still published for scenes elsewhere.
4. **Node prose built around deleted NPCs.** Stage 6 removes group-NPCs and never touches the node
   labels and seeds built around them.
5. **`runConsistency` is dead code** - `canon.restrictions` is always empty, so it returns ok before
   the model call. Repair it with real propositions or delete it; advertising a fact-check that
   never runs is worse than either.

## Measured vs assumed

Assumed, and worth proving before relying on: the narrator removal rule (prompt only, no detector);
the `CAST (at X)` line actually improving prose; the travel guard's cost in turns beyond the single
observed firing.

Never diagnosed: "N turns were rejected by the API" (1/50, 3/31, 4/20 across runs).
