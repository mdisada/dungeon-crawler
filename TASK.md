# TASK.md — Project Tracker & Session Entry Point

**Read this file first, every session, before touching code or other docs.** It exists so a new
session can resume work without re-deriving project state from scratch, and without re-reading
all 15 feature specs every time. Update it before ending any session (see §7).

---

## 1. Source documents — read only what the current task needs

| Document | What it's for | When to read it |
|---|---|---|
| `MAIN-SPEC.md` | Vision, architecture (Agents/Engines/Managers/States/Memories/Tools), tech stack, data model, full feature inventory (§9), build order (§10), key risks (§11) | Once for orientation; re-read a specific section only when a cross-feature architecture question comes up |
| `DEVELOPMENT-PLAN.md` | The BUILD -> AI-TEST -> CHECKPOINT -> GATE workflow, phase-by-phase plan, checkpoint block format, cost discipline, the "Claude Code can't do this alone" catalog | Read §1 once per session (short, governs how you work); read the relevant PHASE section when starting/continuing that phase |
| `docs/F0X-*.md` | Full spec + acceptance criteria for one feature | Read **only** the F0X doc(s) for the feature you are actively building. Do not bulk-read all 15 — that's the token cost this file exists to avoid |
| `TASK.md` (this file) | Live status: current phase, per-feature progress, open decisions, next tasks | Every session, first |

Feature doc index:

| # | Doc | Feature |
|---|---|---|
| F01 | `docs/F01-auth-settings-ai-connectivity.md` | Auth, Settings & AI Connectivity |
| F02 | `docs/F02-character-page-creator.md` | Character Page & Creator |
| F03 | `docs/F03-adventure-creation-wizard.md` | Adventure Creation Wizard |
| F04 | `docs/F04-adventure-guide-pipeline-editor.md` | Adventure Guide Generation Pipeline & Editor |
| F05 | `docs/F05-lobby-session-lifecycle.md` | Lobby & Session Lifecycle |
| F06 | `docs/F06-adventure-page-frontend.md` | Adventure Page (Live Play Frontend) |
| F07 | `docs/F07-live-orchestration-core.md` | Live Orchestration Core |
| F08 | `docs/F08-story-loop-system.md` | Story & Loop System |
| F09 | `docs/F09-combat-engine-tactical-map.md` | Combat Engine & Tactical Map |
| F10 | `docs/F10-social-encounter-system.md` | Social Encounter System |
| F11 | `docs/F11-progression-system.md` | Progression System |
| F12 | `docs/F12-asset-immersion-pipeline.md` | Asset & Immersion Pipeline |
| F13 | `docs/F13-memory-rag.md` | Memory & RAG |
| F14 | `docs/F14-full-ai-dm-mode.md` | Full-AI DM Mode |
| F15 | `docs/F15-observability-telemetry.md` | Observability & Balancing Telemetry |

---

## 2. Current status

**Phase:** Phase 0 gated PASS WITH NOTES, Phase 1 gated PASS, Phase 2 gated PASS, Phase 3a gated
PASS (all 2026-07-17), Phase 3b gated PASS (2026-07-18 — incl. mid-checkpoint amendments 1
[multiple fluid endings] and 2 [entity registry + closed-vocabulary ending signals]), Phase 4
gated PASS WITH NOTES (2026-07-18 — AI-Assist mode moved to Phase 10, human-DM flow design on
hold, design-review answers provisional; see `docs/DECISIONS.md`). See `docs/CHECKPOINTS/` for
archived checkpoints. Carried over from Phase 4: the Immersion-tab music test + CC0 music upload
— user handles music later (see §3 item 5: planned settings-page upload for music/voice); re-test
with F12 in Phase 8.

**Now working on:** `DEVELOPMENT-PLAN.md` PHASE 5 — F07 Live Orchestration + F10 Social
Encounters, Full-AI-first. BUILD + AI-TEST done: migration `20260718130000` applied live,
`session` function redeployed with the full intent pipeline (router → Adjudicator/NPC dialogue →
consistency → auto-applied proposals → single-writer commit), rules `play/` module (179 rules
tests), frontend input row/check prompts/openings/DM Story tab (46 frontend tests), and the
68-check zero-spend live integration suite PASS (plus Phase 4's 43 checks re-run green). At
CHECKPOINT (see `docs/CHECKPOINTS/PHASE5.md`) — the real-LLM solo session and the two-player
cooperation test are user tasks (paid, needs authorization).

**Next up:** On Phase 5 PASS, PHASE 6 (F8 Story & Loop System). TTS moved to Phase 8 (see
`docs/DECISIONS.md` 2026-07-18 Phase 5 BUILD entry).

---

## 3. Decisions (see `docs/DECISIONS.md` for the full record, incl. dates)

1. **Backend architecture: rebuild on Edge Functions per spec.** Supabase Edge Functions become
   the sole AI gateway; Postgres (RLS + single-writer `apply_diff` + `state_version`) becomes the
   sole state authority. The standalone `backend/main.py` Python process + SQLite
   (`backend/data/campaigns.db`) is prototype-only and gets replaced, not repointed. Existing
   Python modules (`backend/campaign/`, `backend/llm/`, `backend/tts.py`, `backend/job_queue.py`)
   remain useful *reference* for logic to port into Edge Functions (see §4 table) but are not the
   long-term runtime.
2. **Frontend data-fetching / state: plain `useState`/`useEffect`, no TanStack Query/SWR/Zustand.**
   `frontend/CLAUDE.md`'s existing convention wins. Root `CLAUDE.md`'s "Data Fetching Rules" and
   "State Management Rules" mandates are overridden for this project — see root CLAUDE.md
   §Project-Specific Overrides.
3. **OAuth deferred; email/password only for v1.** F01 ships with Supabase email/password auth
   only; Google/Discord OAuth is backlog, not v1. Extra attention required on protected-route /
   protected-page guards (F05 lobby membership, F06 adventure page, any DM-only views) since
   there's no OAuth-provider identity layer to lean on — session/auth-guard correctness carries
   more weight than it would with OAuth as a second factor of "is this really the user."
4. **AI-Assist mode moved to Phase 10 (2026-07-18, Phase 4 gate).** The user is not a DM;
   human-DM flow design is on hold. Phases 5–8 build and test with `approval_mode: auto`
   (full-AI behavior, every proposal logged); Phase 9 is F14 hardening; the DM console /
   proposal tray UX (F07 §5) and assist-specific behaviors land in Phase 10 with their own
   design pass. Architecture unchanged — one pipeline, one flag.
5. **Planned (user, 2026-07-18): music + voice-sample uploads move to the Settings page.** The
   user will handle all music-related testing later and wants Settings to host an upload option
   for music tracks and voice samples (a personal media library), rather than only per-adventure
   flows (F04 narrator voice, Storage `music/{adventure_id}/`). Design/build this with F12 in
   Phase 8; touches the F01 settings layout. Until then the music bucket + Immersion tab stay
   untested.
6. **No Docker locally (resolved 2026-07-17).** The user cannot install Docker, so `supabase
   start`/`db reset` (the CLI's local emulation stack) is not the dev workflow. Migrations +
   `supabase/seed.sql` are applied directly to the real, already-linked Supabase project with
   `supabase db push --include-seed --db-url <POSTGRES_URL_NON_POOLING>` — Docker-free, verified
   live via `--dry-run`. Inspect results in the hosted Supabase Studio, not a local one. CI keeps
   using Docker (GitHub Actions runners have it) as the from-scratch migrations-apply-cleanly
   check — that's unaffected by this constraint. See `docs/DECISIONS.md` and `supabase/README.md`.

---

## 4. What exists today (pre-spec prototype)

Everything below predates the spec (all commits before `933c0bc`) and was built as a narrower
"Dungeon Crawler" prototype: AI narrates a story turn-by-turn, a human DM approves/edits, TTS
reads it aloud. **Treat it as reference for reusable UX ideas, not a foundation to extend in
place** — the persistence layer, AI-gateway architecture, and agent model all need rebuilding to
match MAIN-SPEC (see §3.1).

**Worth reusing as reference when building the matching feature:**

| Pattern | Where | Relevant feature |
|---|---|---|
| Sentence/paragraph-chunked TTS streaming, natural pauses, out-of-order buffering | `frontend/src/features/campaign-session/hooks/use-audio-chunk-player.ts`, `use-live-narration-audio.ts`, `backend/tts.py` | F12 |
| "Transition" filler narration streamed while the real draft generates, to cover LLM latency | `backend/campaign/session_handlers.py: _stream_transition_narration`, `backend/campaign/narration.py` | F07 / F12 |
| Branch-option chips + DM edit + auto-publish-with-countdown flow | `frontend/src/features/campaign-session/components/dm-page.tsx` | F07 §5.1 ("Narrate the next story") is the spec version of this |
| Plot-idea generate/improve + undo history + previous-drafts picker | `frontend/src/features/new-campaign/` | F03 |
| A real async job queue over Realtime channels | `backend/job_queue.py`, `backend/realtime_dispatch.py` | F12 Job Queue is the spec version |

---

## 5. Feature status

Status values: **not started** / **early scaffold** / **partial** / **built, ungated** (code
matches spec but hasn't been through a CHECKPOINT/GATE) / **gated** (user has PASSED the
checkpoint — the only status that means "done" per `DEVELOPMENT-PLAN.md` rule zero).

| # | Feature | Status | Existing reference code | Next task |
|---|---|---|---|---|
| F01 | Auth, Settings & AI Connectivity | gated | `supabase/functions/ai-proxy` (+ `ai-credit`, `worker-token`, `worker-heartbeat`), `frontend/src/features/settings/`, `frontend/src/components/navbar.tsx`, RLS migrations | Real BYOK key rotation (Vault-backed) and localStorage fallback still unwired past the settings toggle — backlog, not blocking |
| F02 | Character Page & Creator | gated | `supabase/migrations/20260717150000_create_srd_races_backgrounds.sql`, `..._create_characters.sql`, `packages/rules/src/character/`, `frontend/src/features/characters/` | Backlog (non-blocking): Cleric skill/equipment data gap in SRD source; real image-gen quality + crop-tool feel unjudged (placeholder-mode only); no RTL tests for wizard/crop tool |
| F03 | Adventure Creation Wizard | gated | `supabase/migrations/20260717180000_create_adventures.sql`, `frontend/src/features/adventures/` (old prototype `frontend/src/features/new-campaign/` kept as F04 reference) | Backlog (non-blocking): genre/tone preset chips deferred (F03 §7 nice-to-have) |
| F04 | Adventure Guide Pipeline & Editor | gated | `packages/rules/src/guide/` (canonical stage contracts, mirrored to `supabase/functions/_shared/guide/` via `scripts/sync-guide-shared.mjs` — CI now runs `--check`), `supabase/functions/guide-pipeline/`, `frontend/src/features/guide/`, migrations `20260717190000-200000` + `20260718090000` | Backlog (non-blocking): scenes have no editor surface (hidden scaffolding, per spec); no RTL tests for the editor; live ending scoring (Ending Steward) is F08/Phase 6 |
| F05 | Lobby & Session Lifecycle | gated | migrations `20260718110000-110200`, `supabase/functions/session/`, `frontend/src/features/play/` (lobby modal, join page), `supabase/seed/seed-demo-adventure.mjs`, `tests/integration/session-live.mjs` | Disconnect/auto-delay combat turns + adventure-completion unlock are Phase 5/7 work; music playback test carried to Phase 8 |
| F06 | Adventure Page (Live Play Frontend) | gated | `frontend/src/features/play/` (3 renderers + battle map, DM/Player sidebars, `@rules/state` contract mirrored to `_shared/state`) | Input row / TTS-synced subtitles wired to F07/F12 in later phases; proposal tray scaffold dormant until Phase 10 (AI-Assist deferral) |
| F07 | Live Orchestration Core | built, ungated | `supabase/functions/session/` (intent/prompts/npc-dialogue/narration/proposals/agents), `packages/rules/src/play/`, migration `20260718130000`, `tests/integration/orchestration-live.mjs` | Awaiting Phase 5 gate. Braided intents + loop-mismatch flag need F8 (Phase 6); DM console/proposal tray UX is Phase 10; combat verbs 409 until F09 |
| F08 | Story & Loop System | not started | one pacing counter (`storage.py: turns_since_last_plot_point`) | Everything: Loop Stack Manager, Loop Classifier, Beat Planner, Ingredient Pool, Hook Weaver, Meta Loop Steward |
| F09 | Combat Engine & Tactical Map | not started | none | Everything; depends on SRD data (Phase 0) |
| F10 | Social Encounter System | built, ungated | `supabase/functions/session/npc-dialogue.ts`, `npc_dispositions`/`npc_interactions` tables, `frontend/src/features/play/` (input row, check prompts, openings, Story tab) | Awaiting Phase 5 gate. TTS deferred to Phase 8 (no provider-side voice cloning yet); multi-NPC crosstalk v1.1; interaction-memory embeddings arrive with F13 |
| F11 | Progression System | not started | none | Everything; depends on SRD data (Phase 0) |
| F12 | Asset & Immersion Pipeline | partial | `backend/job_queue.py`, `backend/tts.py`, audio chunk player (see §4) | Image gen (none exists), voice profile upload/cloning, music/ambience; settings-page music/voice-sample upload library (§3 item 5); migrate TTS to spec's gateway model if §3 item 1 requires it |
| F13 | Memory & RAG | early scaffold | `backend/campaign/extraction.py` (flat NPC/lore extraction, no embeddings) | Embedding pipeline (Qwen3 -> pgvector), `query_lore`, Summarizer, spoiler gating |
| F14 | Full-AI DM Mode | not started | none | Auto-approve behavior arrives with F07 in Phase 5; PHASE 9 is the hardening pass (policy table, degradation, X-card), gated on F15 trust data — do not start early |
| F15 | Observability & Telemetry | partial | `usage_log` (Phase 1), `proposals` table + cooperation/incident/consistency events in `event_log` (Phase 5), `frontend/src/lib/job-timer.ts` | Needs structured incidents table + per-trace reconstruction + dashboards (Phase 10) |

---

## 6. Standing rules (every session)

Full detail lives in `DEVELOPMENT-PLAN.md` — this is the summary so it doesn't need re-reading
every time.

+ **Rule zero:** no phase begins until the user PASSES the previous phase's gate. A gate is never
  self-passed by Claude Code.
+ **Loop per feature:** BUILD -> AI-TEST -> CHECKPOINT -> GATE. At CHECKPOINT, stop and emit the
  exact block format from `DEVELOPMENT-PLAN.md` §1.2 (BUILT / AI TESTS / COULD NOT VERIFY / YOUR
  TESTS / YOUR TASKS / DESIGN REVIEW / GATE). Do not scaffold ahead into the next feature while
  waiting on a gate.
+ **Checkbox rule (§1.2):** YOUR TESTS / YOUR TASKS / DESIGN REVIEW render as `- [ ]` checkboxes.
  Every box must be `- [x]` before PASS is valid, unless the user gives a reason - Claude Code then
  appends a `— SKIPPED (<date>): <reason>` note to that line instead of checking it. A plain `PASS`
  with open, unexplained boxes is not a valid gate - point it out rather than advancing anyway.
+ **On a CHANGES verdict:** update the affected `docs/F0X` spec file first, log it in
  `docs/DECISIONS.md`, then implement. Specs stay the source of truth, not the code.
+ **Things only the user can do** (ask proactively, don't silently skip): account/key creation
  (Supabase, Vercel, OpenRouter, OAuth apps), providing media (voice clips, map designs, music),
  multi-device/multiplayer testing, authorizing any paid API call above `$0.10` (state estimated
  cost first), and taste/fun judgment calls.
+ **Repo conventions to maintain** (create these as part of Phase 0): `docs/DECISIONS.md`
  (append-only CHANGES log), `docs/CHECKPOINTS/F0X.md` (archived checkpoint blocks + verdicts),
  test layout (`packages/rules` for pure engine unit tests, `tests/integration`, `tests/fixtures`),
  `PLACEHOLDER_MEDIA=true` + `SEED_DEMO=true` working from Phase 2 onward.
+ **This file:** update it at every checkpoint/gate — move the feature's row in §5, update §2
  "now working on" / "next up", append new open decisions to §3 or note resolved ones inline.

---

## 7. Backlog notes carried from the pre-spec prototype

Preserved from the previous (pre-spec) TASK.md — file/behavior references may need re-validation
once the relevant feature is rebuilt against its F0X spec, but the underlying issues are real and
worth checking when that work starts:

+ TTS was never confirmed working end-to-end on real hardware: no NVIDIA GPU was available during
  prototyping (a CPU fallback exists in the old `backend/tts.py`), and the `norm_loudness=False`
  workaround for a numpy>=2.0 Chatterbox bug (resemble-ai/chatterbox#499) was never cleanly
  confirmed to resolve the "expected scalar type Double but found Float" error. Re-verify once F12
  TTS is rebuilt and real GPU hardware is available.
+ Structured-output parity between the OpenRouter path (`response_format`) and the Ollama path
  (native `format`) was unconfirmed — Ollama's schema support is more limited.
+ SPA history-mode fallback (a rewrite rule so refreshing a deep link like `/adventures/new`
  doesn't 404) will be needed for production hosting — remember when setting up Vercel in Phase 0
  or Phase 1.
