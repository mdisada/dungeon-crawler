# Encounter-States Simulation Report (2026-07-19)

Post-implementation playtest of the encounter-states machine (docs/PLANS/encounter-states.md,
Slices 1-7 deployed). An LLM player (deepseek-v4-flash) played against the deployed full-AI DM
on the existing adventure **"Whispers from the Deep"** (12 segments, ~95 turns, driven to a
committed ending), plus one assist-mode segment on **"The Chill of Despair"**. Both adventures
were snapshotted and fully restored afterward. Total spend for all paid testing (probes +
sims): **~$0.15**.

Transcripts: `tests/integration/story-sim-transcript.txt` (full-AI, with finale) and
`tests/integration/story-sim-assist-transcript.txt` (assist).

## Result

- **Ending reached**: "The Whispering Echo" auto-committed (scores Echo 8 / Chorus 5 /
  Abyssal 3 / Sanity 2 - exactly the decisive margin), climax re-authored live, finale
  narration published. All 4 objectives completed.
- The machine ran end to end in real play: cutscene -> entry mapping (offered AND ad-hoc) ->
  typed encounters with visible frames -> tiered resolution -> outcome maps -> beat exits ->
  next beat. A failed authored challenge organically triggered a Slice-6 random encounter
  ("Sudden hazard near Sunken Altar") that interrupted and later restored play.
- Assist mode: the machine correctly stays out (free adjudication, human-DM authority);
  a full quest-accept -> beat -> checks -> NPC-conversation session ran cleanly with
  auto-dialogue/auto-checks on. 11 coherent turns, $0.008.

## Flow & pacing assessment

**What reads well:** Narration quality is strong and grounded; the exposition style delivers
real hooks ("Do you ascend, or do you hesitate?"); encounter stakes are concrete; the
entry mapper honors off-script play by structuring it (a declared climb became a designed
ad-hoc challenge with sensible skills/DCs) instead of stonewalling; random-encounter
interruptions land dramatically and restore cleanly.

**Pacing findings (fixed during the run, deployed):**

1. **Stale-beat loop** - a beat outliving its completed objective kept re-offering a dead
   encounter with a dead vocabulary. Fixed: objective completion now forces a beat re-plan
   (`progress.ts`, trigger `objective_completed`).
2. **Failure grind** - cold dice + empty `on_failure` maps re-offered the same wall 3x.
   Fixed via planner prompt: fail-forward mapping is now demanded (exits = success atom OR
   setback atom; on_failure maps to the setback).
3. **flag/fact namespace split** - planners author `flag` atoms where guides authored `fact`
   atoms of the same name; outcome maps fired into flags while predicates read facts.
   Fixed: `applyMilestones` dual-writes any name that exists in both vocabularies.
4. **snake_case drift** - the planner normalized spaced milestone text ("party investigated
   derelict boat" -> "party_investigated_derelict_boat"), disconnecting outcome maps from
   authored predicates. Prompt now demands character-for-character copies; the parser
   rejects drift (which correctly forced fallback plans in the sim).
5. **Wedged typing after worker kills** - the quest-accept chain (classifier + planner x2 +
   designer + weaver + narrator + checker) can exceed the edge worker limit; a killed worker
   left `typing: true` and the 2-min self-heal was starved by dm_command events. Mitigated:
   typing-clearing guards around the accept-chain and entry mapping; the self-heal remains
   the backstop for hard kills.
6. **Embedded provider refusals** - "The request was rejected..." arrived appended to good
   narration once; the sanitizer now strips the canonical sentence anywhere in the text.

**Pre-machine guide debt (expected, per plan release note):** this guide's objective 2
predicate keys an NPC fact by *name* with a `talked_to` status the runtime never writes, and
its ending signals hinge on BBEG npc-state/dials that live play rarely touches. Both needed
DM-override canonization (`mark_event`/`set_fact`/`set_npc_state` - all standard DM commands)
of things that had actually happened in the fiction. **Regenerate guides** so Stage 4-6
author predicates/signals in the machine's claimable vocabulary; per-location
`danger`/`encounter_table` authoring is also still pending in the guide stages (runtime
fallback table covers it meanwhile).

**Remaining pacing observations (not bugs):**

- ~8 turns per 6.5-minute segment; each turn is adjudicator + narrator + checker (~30-45s).
  Fine for play, slow for sims.
- The sim player's character (cloned, low modifiers) failed most DC 13-15 checks; challenges
  tuned by the designer assume a competent party. Real parties with proficiencies will pace
  faster.
- Encounter re-entry after failure is allowed by design; with fail-forward maps now enforced
  it should be rare - watch for it in the next playtest.
