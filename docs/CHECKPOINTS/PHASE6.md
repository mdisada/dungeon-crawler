=== CHECKPOINT: F08 — Story & Loop System + reactive story contract (Phase 6) ===

BUILT:

- **Reactive story contract (user CHANGES at kickoff, specs updated first — F08 §2.1/§2.2/§9.1,
  F04 §4.3, F07 §5.1):** quests are offered, not imposed. The entry contract stages an in-fiction
  offer at session start (first objective stays hidden until acceptance; the opening premise
  prompt forbids presumed motivation); players answer in free text — accept/decline/negotiate
  detected by a classifier ahead of normal routing, any PC's clear accept binds the party;
  haggling rolls real persuasion bounded by the authored floor/ceiling; declines are honored
  (disposition shift, steward event, ≤ 2 escalating re-weaves — automated once ~8 events pass —
  then `consequence_due`); payouts credit the party ledger exactly once. Offer banner, minimal
  quest journal, and party gold render for everyone; system lines mark accept/decline/payout.
- **Quest contracts authored in the guide (F04 §4.3):** Stage 6 emits exactly one entry contract
  (giver hard-validated to a first-chapter NPC; dangling refs = stage failure) + optional side
  contracts; re-runs preserve human-edited rows. Contract editor cards in the Plot tab (giver
  picker, floor/ceiling, stakes, objective chips); Start-Adventure validation requires a valid
  entry contract. Demo seed now opens on Maren's offer (25-60 gp bounds).
- **Loop stack + beats (F08 §2/§4):** `core_loops`/`beats` tables; push/suspend/resume/complete
  ops with beat-position preservation; acceptance pushes a quest loop and opens its first beat;
  beat exit conditions (same predicate atoms as F04) open the next beat automatically —
  event-driven pacing, "Narrate next" stays as override. Beat Planner receives variety guidance,
  objective + hidden notes, party composition, and the undiscovered ingredient pool — pool items
  are reused before anything is generated; unmet requests become ingredients from the request's
  purpose text. Braided pairs are emitted only when the composition supports them (soft-dropped
  otherwise) — live linked-DC resolution is Phase 7 work (F09 consumes the same link shape).
- **Loop Classifier (F08 §3):** deterministic off-loop streak (intent pillar vs the loop
  template's profile, 3+ triggers) + DM `reclassify`; proposals at ≥ 0.65, full-AI auto-accept
  at ≥ 0.8 (applies suspend/complete + push + first beat + journal refresh), mid-band defers
  with a 5-event cooldown. Malformed classifier output degrades to on_loop — never a false pivot.
- **Live Hook Weaver (F08 §6):** refreshes per-objective hooks on beat opens (delivered as
  Narrator/NPC context, never broadcast); automated offer re-weaves come from a different angle
  with escalated terms.
- **Variety Manager (F08 §7):** pure counting over the event log — same-loop-type window,
  per-player pillar starvation (2-session window), `coop_low`/`coop_fatigue`/`spotlight` — fed
  to the Beat Planner as guidance lines, never hard constraints.
- **Objective flow (F08 §9):** deterministic predicate evaluator (fact/flag/event atoms,
  any/all) over `dm.facts.world`/`flags` + `story_event` markers; completion advances the
  reveal order, patches state, and narrates the reveal via hook, not task list. DM override
  family: `set_flag`/`set_fact`/`mark_event`/`complete_quest`/`plan_beat`/`reclassify`/
  `advance_day`.
- **Ending Steward (F08 §8.1):** deterministic scoring on every progress pass (argmax, index
  tie-break — one always leads), `leading` status + scores persisted; commitment only at the
  final objective with margin ≥ 3 and ≥ 30 recorded events; full-AI auto-commit gated on the
  Consistency scan; the climax is re-authored live from the event log at commitment; dial
  nudges (±1/±2 clamped, justification logged) run over the session transcript at session end.
- **Meta Loop Steward (F08 §8):** antagonist turns on `advance_day` and session end (plan
  accretes, surfacing auto-becomes a rumor ingredient in full-AI, pending proposal in assist);
  suspicion tally via registry-name + keyword heuristic; BBEG commitment at tally ≥ 5 with
  ≥ 2 sessions (full-AI commits only if the NPC isn't dead) + retro hook.
- **Player-theory canonization (F08 §5):** NPC-proposed `canonize_theory` runs a registry-wide
  Consistency scan — clean → `player_theory` ingredient (full-AI auto); contradiction →
  `canonization_blocked` with the conflict shown. DM "Make it true" UI arrives with Phase 10.
- **Idle nudge (F08 §9.1):** DM-client sweep → server validates idleness (event-log age ≥
  threshold, default 3 min, `set_auto {nudge_minutes}`), dedupes, and produces one in-fiction
  nudge that never advances plot.
- **Narrator contract:** every beat ends at a concrete decision point; no formulaic closer;
  never presumes party motivation.
- **Deviations (full detail in `docs/DECISIONS.md` 2026-07-18 Phase 6 entries):** braided live
  resolution → Phase 7; Adjudicator `propose_objective_completion` (ambiguous atoms) deferred —
  v1 completion is deterministic predicates + DM overrides; emergent/refusal ending authoring +
  the holistic ending confirm pass wait on F13 condensed summaries (`consequence_due` is the
  authored hook); backstory interlocks wait on F11 personal loops; suspicion is the §11
  starting heuristic; progress passes run at story-relevant points, not literally every diff.

AI TESTS:

- `packages/rules`: **255/255 pass**, `tsc --noEmit` clean — new story suite: loop stack ops
  (push suspends incumbent + preserves beats, complete auto-resumes topmost, double-complete
  rejected), offer caps/re-weave budget/reward-bounds clamps/response parser, classifier streak
  arithmetic + threshold policy per mode + malformed-degrades-to-on_loop, beat plan parsing
  (predicate exits validated, braided pairs composition-gated and soft-dropped for solo/absent
  skills), predicate evaluator (unknown facts never hold), ending scoring (re-ranks on flipped
  signals, tie-break, negative weights, dial clamps, late+decisive commitment gate, closed-
  vocabulary signal parsing), variety flags (loop-type window, pillar starvation, coop_low/
  fatigue, spotlight floor); stage 6 contract parsing (entry uniqueness, dangling refs,
  inverted rewards = failures) and Start-Adventure contract validation.
- `frontend`: `tsc -b` 0 errors, `eslint .` 0 errors, `npm run build` clean, **60/60 tests**
  (offer banner rendering + journal diffs through the merge-patch pipeline).
- **`tests/integration/story-live.mjs` — 92/92 checks PASS against the deployed function +
  live DB, $0 spend (usage_log asserted 0):** entry gating (offer staged at session start,
  objective hidden until acceptance, no presumed-motivation opening), unrelated talk falls
  through, bounded haggling (terms never exceed ceiling, offer stays open), decline honored →
  re-weave escalates with reweave_count, any-accept binds (objection stays conversation),
  acceptance opens the first beat (pool clue reused, generator not called, live hooks planted),
  classifier pivot at 0.9 (quest suspended + journal paused + siege loop opens 'warning'),
  beat exit via marker event opens 'preparation', ledger payout exactly once (second call
  409s), objective completion by predicate → ending scores computed → decisive late lead
  auto-committed (statuses written, climax narrated), idle nudge validates idleness, journal
  survives session restart, antagonist turn at session end (rumor ingredient created),
  suspicion tally → BBEG committed at threshold across 2 sessions, canonization (clean theory
  → ingredient; theory naming a dead NPC blocked with conflict), RLS (players read no offers/
  loops/beats/contracts/meta_loop rows).
- Regressions: Phase 5 orchestration suite PASS (123 checks), Phase 4 session suite PASS (46).
- Migrations `20260718150000/160000/170000` applied live; `session` + `guide-pipeline`
  deployed; `sync-guide-shared.mjs --check` green across all five mirrors.

COULD NOT VERIFY:

- **Everything real-LLM:** offer-classifier accuracy on ambiguous phrasings ("fine, whatever"),
  Beat Planner beat quality and whether goals read as situations, classifier pivot judgment on
  live play, Hook Weaver subtlety, narration actually ending on decision points with real
  models, Stage 6 contract quality (reward sizing, stakes prose), dial-nudge sanity, steward
  off-screen event quality, climax re-authoring. All need your paid session.
- **The feel of the reactive loop:** does being asked (and haggling, and saying no) beat the
  old presumed-motivation opening in play? Does the idle nudge feel like a table, not a nag?
- Whether auto-pivots match your DM instincts (the deliberate-derail test below).
- Braided beats in real cooperation (deferred resolution — Phase 7 will make this testable).

YOUR TESTS:

- [x] Free (demo): delete the old demo adventure, reseed
      (`node supabase/seed/seed-demo-adventure.mjs "$POSTGRES_URL_NON_POOLING" <your email>`),
      start a session — it must open on Maren seeking you out with the missing-boy job (no
      "you have come here to..."), banner + journal visible. Haggle ("pay us more..."), then
      accept in your own words; watch the first beat open. Complete it via the DM override
      (`set_fact boy_found true` from a dm_command, or complete_quest) and watch the payout hit
      the party gold.
- [ ] Free (demo): decline the offer instead (fresh reseed): confirm the refusal is honored,
      then re-woven later from a different angle, and that the third decline stops the asking.
- [ ] **Paid (~$2-4, say go before running):** one real-model session on your generated
      adventure (regenerate the guide first so Stage 6 authors contracts): judge the offer
      scene, the narration's decision-point discipline, and beat pacing. Mid-session,
      deliberately derail (prepped story → start fortifying/side-quest hard) and judge the
      pivot proposal timing + the first pivoted beat. Try one "my theory is..." canonization.
      End the session and read the antagonist report + dial nudges + suspicion tally in the
      event log / proposal tray.
- [ ] Two-player 15 min (paid, small): confirm one player's accept binds the table after the
      other objects, and that the journal/banner stay in sync on both screens.

YOUR TASKS:

- [ ] Authorize the paid session(s) above (your OpenRouter key).
- [ ] Regenerate (or hand-add contracts to) any guide_ready adventures you want to keep — they
      predate quest contracts and will fail Start-Adventure validation until Stage 6 re-runs.

DESIGN REVIEW:

- [ ] Loop template library: are the 10 types + 3-5 beat templates enough at launch (F08 §11)?
- [ ] Classifier thresholds (0.65 propose / 0.8 auto) and the 3-intent mismatch streak — right,
      from the pivots you saw?
- [ ] Offer knobs: re-weave budget 2, escalation "halfway to ceiling", 2-open-offer cap,
      haggling margin ≥ 5 = ceiling — do the numbers feel like a real table?
- [ ] Ending commitment gate (margin ≥ 3, ≥ 30 events, final objective) and BBEG threshold
      (tally 5, 2 sessions) — too eager, too shy?
- [ ] Idle nudge default (3 min) and tone.

GATE: one deliberate-derail session where the system stayed a beat ahead of you rather than
fighting you — plus the offer flow feeling like being asked, not assigned.
