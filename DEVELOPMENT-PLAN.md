# DEVELOPMENT-PLAN.md — Claude Code Workflow & Checkpoint Gates

**Companion to:** `main-spec.md` + `specs/F01–F15`
**Audience:** Claude Code (executor) and Miguel (product owner / tester)
**Rule zero:** No phase begins until the previous phase's gate is PASSED by the user. A gate is never self-passed by Claude Code.

---

## 1. How this works

### 1.1 The loop per feature

```
BUILD → AI-TEST → CHECKPOINT (user tests + design review + human tasks) → GATE → next
```

- **BUILD:** Claude Code implements against the feature spec. Any deviation from the spec is listed in the checkpoint, never silent.
- **AI-TEST:** Claude Code writes and runs automated tests covering the spec's acceptance criteria that are machine-verifiable, and reports results honestly — including what it could NOT verify (anything needing real API keys, real audio playback, multiple devices, visual judgment, or paid API calls the user hasn't authorized).
- **CHECKPOINT:** Claude Code stops and prints the checkpoint block (§1.2). It does not continue, scaffold ahead, or "get a head start" on the next feature.
- **GATE:** User replies `PASS`, `PASS WITH NOTES: ...`, or `CHANGES: ...`. On CHANGES, Claude Code updates the affected spec file(s) first, records the decision in `docs/DECISIONS.md`, then implements — specs stay the source of truth. Per §1.2's checkbox rule, PASS requires every YOUR TESTS / YOUR TASKS / DESIGN REVIEW checkbox to be checked or explicitly excused — Claude Code checks the user's own gate reply against the archived checkpoint file before treating a PASS as valid, and flags back if boxes are still open with no reason given.

### 1.2 Checkpoint block format (Claude Code must emit exactly this structure)

This is the shape (shown fenced here purely to illustrate the literal syntax) — **the actual
checkpoint Claude Code prints in chat, and archives under `docs/CHECKPOINTS/`, must NOT be
wrapped in a code fence.** It renders as real markdown (bold or heading labels, real bullet
lists, real `- [ ]` task-list checkboxes) so the checkboxes are genuinely checkable in a
markdown viewer (GitHub, VS Code preview, etc.) — a fenced block turns them into inert text,
which defeats the point.

```
=== CHECKPOINT: F0X — <name> ===
BUILT: <what was implemented, deviations from spec flagged>
AI TESTS: <suites run, pass/fail counts, coverage of acceptance criteria>
COULD NOT VERIFY: <explicit list — needs user hands/eyes/devices/keys>
YOUR TESTS:
- [ ] <manual test step 1, copy-pasteable>
- [ ] <manual test step 2>
      (~5–15 steps total)
YOUR TASKS:
- [ ] <thing only you can do — uploads, dashboard config, accounts>
DESIGN REVIEW:
- [ ] <question 1 about direction before it gets expensive to change>
- [ ] <question 2>
      (2–4 questions total)
GATE: reply PASS / PASS WITH NOTES / CHANGES
```

**Checkbox rule.** Every `- [ ]` under YOUR TESTS, YOUR TASKS, and DESIGN REVIEW must become
`- [x]` before the checkpoint can be gated PASS. If the user wants to proceed with a box left
unchecked, they say why in their gate reply (or directly in the file); Claude Code then edits that
line in place to append `— SKIPPED (<date>): <reason>` and leaves the box unchecked (never checks
a box that wasn't actually done). A gate reply of plain `PASS` with open, unexplained checkboxes is
not valid — Claude Code points this out instead of silently advancing to the next phase. This
applies to every checkpoint file under `docs/CHECKPOINTS/`, including `PHASE0.md`.

### 1.3 Repo conventions Claude Code must maintain

- `CLAUDE.md` at repo root containing: pointer to main spec + specs folder, the rule-zero gate policy, current phase status, and the checkpoint block format. Claude Code updates the "current phase" line at every gate.
- `docs/DECISIONS.md` — append-only log of every CHANGES decision (date, what, why, which specs updated).
- `docs/CHECKPOINTS/F0X.md` — each emitted checkpoint block + the user's verdict, archived.
- Test layout: `packages/rules` (pure engine unit tests — the golden files live here), `tests/integration` (DB/RLS/pipeline), `tests/fixtures` (seeded adventures, transcripts, combat scripts).
- `PLACEHOLDER_MEDIA=true` and a `SEED_DEMO=true` script (demo adventure + 2 demo characters + fixture content) must work from Phase 2 onward so the user can always test without burning API credits.
- **No local Docker on the dev machine (decided 2026-07-17, see `docs/DECISIONS.md`).** Supabase schema changes are authored as hand-written migrations under `supabase/migrations/` and applied straight to the linked Supabase project with `supabase db push --db-url <POSTGRES_URL_NON_POOLING>` (migrations) and `node supabase/seed/apply-seed.mjs "$POSTGRES_URL_NON_POOLING"` (seed data — not `db push --include-seed`, which only executes the seed file once and silently no-ops on later changes) — this talks to Postgres directly and needs no local Docker stack (`supabase start`/`db reset` are not used for day-to-day dev). Verify results in the **hosted** Supabase Studio (supabase.com/dashboard), not a local one. Docker is still used, but only inside CI (`.github/workflows/ci.yml`'s `supabase-migrations` job runs on GitHub's hosted runners, which have Docker regardless of the developer's machine) as the from-scratch "do migrations apply cleanly" check.

### 1.4 Standing "Claude Code can't do this" catalog

Claude Code must proactively ask the user whenever a step needs:

- **Accounts & keys:** Supabase project creation, Vercel project, OpenRouter key + spend limits, OAuth app setup in Google/Discord dashboards, setting edge-function secrets.
- **Media only you can provide:** voice clips for cloning (your voice or licensed samples), your map designs (1024×1024), music files (CC0/licensed), taste-testing generated art.
- **Multi-device / real-network testing:** two browsers/accounts for multiplayer, phone testing (especially iOS Safari audio), actual latency feel.
- **Paid-call authorization:** any test that spends real OpenRouter credit (Claude Code asks before running, states estimated cost).
- **Judgment calls:** prose quality, VN layout feel, whether the AI DM is *fun* — automated tests can't measure fun.

---

## 2. Phase plan

Build order follows main-spec §10. Each phase lists what's distinct about its checkpoint; the full acceptance criteria live in each feature spec and are not repeated here.

---

### PHASE 0 — Project foundation (no feature spec; prerequisite)

**Build:** repo scaffold (bulletproof-react, Vite, TS, shadcn), Supabase migration tooling (direct-to-project `db push`, no local Docker stack — see SS1.3), CI (typecheck, lint, tests), `packages/rules` package, SRD 5.2.1 data ingestion script → seed tables, CLAUDE.md + docs skeleton.
**AI-test:** migrations up/down clean; SRD seed counts match source (spot-check fixtures: e.g. goblin stat block, fireball, fighter table).
**Your tasks (blocking):** create Supabase project + enable pgvector; create Vercel project; create OpenRouter account + key + spend limit; provide keys as env/secrets (Claude Code tells you exactly which names, never asks you to paste secrets into chat/files that get committed).
**Design review:** monorepo layout OK? SRD license attribution placement (required by CC-BY) approved?
**Gate:** you can run the app locally, see a blank authenticated shell, and CI is green.

---

### PHASE 1 — F1 Auth, Settings & AI Connectivity

**AI-test:** RLS cross-user denial tests; role→model resolution unit tests; proxy contract tests with a mocked provider; usage_log writes.
**Could not verify (yours):** real OpenRouter round-trip + streaming feel; **the Voxtral-streaming-through-OpenRouter validation** (F1 §3.2) — Claude Code writes the probe script, you run it and paste the result; OAuth flows against real Google/Discord apps.
**Your tasks:** OAuth app creation in both provider dashboards (Claude Code gives step-by-step + redirect URLs); set `OPENROUTER_API_KEY` secret; run the TTS streaming probe (~$0.02); decide default spend limit.
**Design review:** billing model confirmation (creator pays for all adventure AI calls — F1 open question); is the settings page layout right before more sections pile on?
**Gate:** you log in with OAuth, send one real narrator-role text call from the settings page test box, see streamed output + navbar spend update. TTS provider routing decision recorded in DECISIONS.md.

---

### PHASE 2 — F2 Character Page & Creator

**AI-test:** rules-math golden tests (AC/HP/save/skill fixtures per class), Point Buy validation, draft persistence, crop-export dimension tests (canvas snapshot).
**Could not verify:** image generation quality; cropping tool feel; whether the wizard is pleasant.
**Your tasks:** authorize a small image-gen budget (~$1) and generate 3–4 characters for real; judge the prompt template output and edit it if the style is wrong; create the 2 demo characters you'll use for all future testing.
**Design review:** is 8 wizard steps too many (merge candidates: 4+5)? Is the generated `background_narrative` tone right? Approve the placeholder art set.
**Gate:** you create a complete character with a real generated portrait and all three crops render correctly in a preview strip. **A design change here is cheap; the same change after F6 is not — take this review seriously.**

---

### PHASE 3 — F3 + F4 Adventure Creation & Guide Pipeline

Two sub-checkpoints; F4 is the highest content-risk feature in the project.

**3a — F3 Wizard.** Quick: AI-test covers autosave/undo-redo/validation. Your test: create a draft, generate + improve a plot, verify undo history survives reload. Gate in one sitting.

**3b — F4 Pipeline & Editor.**
**AI-test:** schema-conformance tests per pipeline stage (mocked LLM with recorded fixtures + live smoke run against cheap models on your authorization); predicate builder round-trip; regeneration-preserves-human-edits diff test; cooperative-set conformance (coop sets present when min_players ≥ 2, density guardrail respected, affinity binding fixture with 3-PC and 1-PC parties).
**Could not verify:** whether the generated adventure is *good* — coherent chapters, non-spoiling objectives, interesting NPCs; map-gen image quality (F4 open question).
**Your tasks (this is the big one):**

1. Authorize a full pipeline run (~$0.50–2 depending on models) on a plot you actually want to play.
2. Read the whole generated guide critically: do objectives stay short and open? Do hidden descriptions catch the plot? Are ingredients toys, not railroads? With min_players ≥ 2: are the cooperative sets sensible (split clues that genuinely need pooling, complementary obstacles that aren't arbitrary padlocks), and do the `reveals_to` affinities map onto plausible party shapes?
3. **Upload a narrator voice clip** (3–30s WAV) and preview the clone.
4. **Test map generation, then decide:** generated maps / your uploaded 1024×1024 map designs / templated abstract zones (F4 open question). Upload 2–3 of your own map designs regardless — the upload path must work.
5. Record 1–2 NPC voice clips and assign them.
**Design review:** ingredient volume per chapter (default 6–10 — right?); predicate builder usable or does it need presets ("NPC defeated", "location reached")?; editor tab layout.
**Gate:** a guide you'd genuinely run exists in the DB, with your voice on the narrator, your verdict on maps recorded in DECISIONS.md.

---

### PHASE 4 — F5 + F6 Lobby, Session Lifecycle & Live-Play Frontend (dummy content)

**AI-test:** presence/capacity/locking integration tests; checkpoint snapshot-hash test; state-diff renderer tests (mode transitions from scripted diff sequences); DM-data-isolation network test.
**Could not verify:** true multi-client behavior; responsive/mobile layout; the *feel* of all three renderers.
**Your tasks:** two-browser (or you + a friend) lobby test: join, pick characters, ready, start; walk a scripted demo session (SEED_DEMO drives fake state diffs through narration → roleplay → battle); test on your phone; confirm the audio-unlock gesture works on your devices.
**Design review — the big visual one:** VN layout (portrait positions, text box) approved? Map usability (pan/zoom/drag) approved? Sidebar information density? **Changes to these layouts are last-cheap here.**
**Gate:** two real clients stay in sync through all scene modes with dummy content; you sign off the three renderers.

---### PHASE 5 — F7 + F10 Live Orchestration & Social Encounters (AI-Assist)
The first phase where the game is actually played with AI.
**AI-test:** router classification fixture suite (fast-path never hits LLM — usage_log assertion); state_version race test; DC clamping; proposal lifecycle; reveal-gating adversarial test; consistency-block seeded test; cooperation resolution fixtures (group check with idle auto-roll, assisted check both variants + timeouts, assist-skill-exists property test, social-opening emit/consume/expiry with self-consume blocked).
**Could not verify:** dialogue quality, latency feel, whether the proposal tray workflow is comfortable at the table; whether cooperation prompts read as invitations or nagging.
**Your tasks:** run a 30–60 min solo AI-assist roleplay session on your generated adventure (~$1–3, authorized): free-text actions, influence checks, "Narrate the next story" options flow, one generic on-the-fly NPC, at least one override and one proposal edit; listen to streaming TTS with your cloned voices; note every moment the AI felt slow or wrong. Then bring a second account or a friend for ~15 min of two-player testing: one group check, one assisted check (both enable and bonus if possible), one insight→opening handoff (PC A's Insight success eases PC B's Persuasion), and confirm the NPC directs at least one question at the quieter player.
**Design review:** latency verdict vs the 4s target (merge Adjudicator+Narrator? — F7 open question); proposal tray ergonomics (auto-apply timers right?); NPC dialogue tone per model — is MiMo the right narrator or reroute?
**Gate:** you complete a social scene you'd describe as "actually fun," and the model-map decisions are recorded.

---

### PHASE 6 — F8 Story & Loop System

**AI-test:** the transcript fixture suites (pivot detection, no-false-pivot, suspend/resume, pool-reuse-before-generate, canonization conflict block, steward clock ticks, variety flag firing — including `coop_low`, `coop_fatigue`, and `spotlight` against seeded event logs); braided-beat emission gated on composition profile; interlock-guardrail predicate fixture.
**Could not verify:** whether loop pivots match your DM instincts on live play; whether braided beats feel exciting or contrived.
**Your tasks:** play a session where you deliberately derail (prepped mystery → start a siege): judge the pivot proposal timing and the Beat Planner's first beat; try "Make it true" on one of your own theories; end-of-session, read the Steward's antagonist report and suspicion tally. With a friend: run one braided beat (distraction + office search) and verify the outcomes visibly modify each other; check that your two characters' backstory interlock surfaced and connects rather than gates.
**Design review:** loop template library — 10 types enough? Confidence thresholds (0.65 propose / 0.8 auto) feel right from the proposals you saw? BBEG suspicion threshold?
**Gate:** one deliberate-derail session where the system stayed a beat ahead of you rather than fighting you.

---

### PHASE 7 — F9 + F11 Combat, Map & Progression

**AI-test:** the heaviest suite in the project — golden-file scripted combats (seeded RNG, byte-identical logs), SRD math fixtures, condition matrix property tests, Tactician legal-action property test, minion zero-LLM assertion, XP/level-up fixtures L1–5, renown/piety idempotency; teamwork suite: combo-pattern golden tests (incl. no-false-combo negatives), Momentum cap/reset/spend + solo-mode via allied NPC, paired-mechanic same-round fixture with off-by-one negative, protect-the-objective predicate win, Budget multiplayer-assumption comparison (min_players 1 vs 3), party-asset second/race/timeout tests, ally-only boon self-target rejection.
**Could not verify:** combat pacing and fun; map handling under real fingers; whether difficulty labels feel true; whether combos and Momentum actually change how your group plays.
**Your tasks:** **upload your map designs** for the test encounters; run three playtests (friends strongly recommended — this is the multi-device stress test): (1) standard fight on Standard, (2) same fight on Deadly with a mid-combat difficulty slide, (3) boss fight with phases + an allied NPC joining mid-combat (talk the captain into fighting → Tactician runs him → seize control for one turn) + a paired-mechanic minion pair (linked channelers you must disrupt in the same round). Across the playtests: trigger at least two combos (shove→attack, grapple→ranged shot), earn and spend Momentum, and consume one party asset so the "second" vote flow gets real use. Then level a character up (checking an ally-targeted boon at piety tier 2) and distribute loot.
**Design review:** difficulty preset constants vs how the fights actually felt (F15 metrics assist here once live); turn timer / reaction window durations; is the 8s Tactician auto-apply right? Cooperation review: did combos feel discovered or checklisted; is Momentum's cap-3 pool the right size; did the multiplayer budget assumption make fights demand coordination without feeling punitive?
**Gate:** all three playtests completed without desync; you'd let strangers play this combat.

---

### PHASE 8 — F12 + F13 Media & Memory hardening

**AI-test:** queue recovery/poison tests; TTS ordering-under-concurrency test; cache-hit test; retrieval quality fixture (≥85% top-3); spoiler-gate scan; promise-recall fixture; embedding re-index on edit.
**Your tasks:** **upload the music starter pack** (CC0 tracks you pick) and tag them; **record the generic NPC voice pool** (6–8 clips) or source licensed ones; iOS Safari audio test on a physical device; multi-session memory test — play session 1, make an NPC a promise, start session 2 days later, verify the recap and the NPC both remember.
**Design review:** recap length/tone; retrieval misses you noticed during Phase 5–7 play (tune k / chunking now); embedding dimension verdict if latency bothered you.
**Gate:** the promise-recall test passes with your own eyes, and audio works on every device you own.

---

### PHASE 9 — F14 Full-AI Mode (gated by F15 data)

**Pre-gate (before building):** Claude Code presents the F15 trust report from all your assist-mode play (acceptance rates per agent vs the F14 §7 thresholds). **If thresholds aren't met, the correct move is more assist-mode play and prompt tuning, not building Full-AI anyway** — Claude Code must say so.
**AI-test:** policy-table resolution tests; conservative-objective fixture; degradation-ladder fault injection; X-card broadcast timing; wipe-path fixtures.
**Your tasks:** run one complete full-AI one-shot solo, then one with 2–3 friends (the real readiness test); deliberately try to break it: claim false completions ("we already killed Volgarth"), go wildly off-plot, disconnect mid-combat; press the X-card once. During the friends run, watch the cooperation systems operate unattended: a group check auto-rolling for an idle player, an assist prompt resolving on timeout, a split-clue set pooling, and the F15 cooperation telemetry (consumed/offered ratios, spotlight distribution) populating afterward — this data is your evidence the full-AI DM runs a *party*, not four parallel solo games.
**Design review:** the per-type policy table — anything you'd move from auto back to never? Defeat-consequence vs Hardcore default?
**Gate:** the friends one-shot completes, everyone had fun, and the incident log shows < 1 error-severity event.

---

### PHASE 10 — F15 dashboards (final polish; logging existed since Phase 1)

**AI-test:** metric computation fixtures; replay byte-identity; trace reconstruction.
**Your tasks:** review the creator-facing panels — is the cost breakdown what you want to see? Run one replay of a Phase 7 combat.
**Design review:** what to expose to other DMs eventually (encounter difficulty report — v1.1?).
**Gate:** you can answer "what did last session cost and which agent do I trust least" from the UI in under a minute. Ship it.

---

## 3. Change-management rules (for CHANGES verdicts)

1. Spec first, code second — the affected `specs/F0X` file is edited in the same PR as the change.
2. If a change ripples (e.g. VN layout change touches F6+F10), Claude Code lists the ripple before implementing and re-confirms.
3. Deviations discovered mid-build (spec impossible/contradictory) → mini-checkpoint immediately, not at phase end.
4. Scope additions requested mid-phase go to `docs/BACKLOG.md` by default; pulled in only with an explicit user go — protects the gate cadence.

## 4. Cost discipline

Claude Code never runs paid-API tests without stating estimated cost and getting a go. Standing authorization tiers the user can grant: `AUTO_OK_UNDER=$0.10` per test run (recorded in CLAUDE.md), everything above asks. Fixtures + recorded LLM responses + PLACEHOLDER_MEDIA keep 90% of testing free.
