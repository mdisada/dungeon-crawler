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

**Phase:** Phase 0 (foundation), starting. The spec framework (MAIN-SPEC, DEVELOPMENT-PLAN, all
F0X docs) was adopted 2026-07-16. The §3 open decisions were resolved with the user the same day
— see §3 for the record. Nothing in the codebase has been built against the spec yet — see §4.

**Now working on:** `DEVELOPMENT-PLAN.md` PHASE 0 — BUILD + AI-TEST done, at CHECKPOINT (see
`docs/CHECKPOINTS/PHASE0.md`), awaiting the user's gate verdict.

**Next up:** On PASS, move to PHASE 1 (F1 Auth, Settings & AI Connectivity). Do not start Phase 1
work before the gate verdict lands (rule zero).

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
4. **No Docker locally (resolved 2026-07-17).** The user cannot install Docker, so `supabase
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
| F01 | Auth, Settings & AI Connectivity | early scaffold | `frontend/src/features/auth/` (email/password only); `backend/llm/` (OpenRouter + Ollama client, no per-role routing) | Resolve §3 items 1 & 3, then build per spec: Edge Function proxy, per-role model map, `usage_log`, settings page |
| F02 | Character Page & Creator | not started | none | SRD race/class/background data ingestion is a prerequisite (Phase 0) |
| F03 | Adventure Creation Wizard | partial | `frontend/src/features/new-campaign/`, `backend/campaign/plot.py` | Add mode select (Full-AI/AI-Assist), player min/max, chapter bounds |
| F04 | Adventure Guide Pipeline & Editor | early scaffold | `backend/campaign/plot_points.py` (flat plot-point list only), `extraction.py` | Everything past the flat list: chapters/scenes/objectives w/ completion predicates, Ingredient Generator, Hook Weaver, Encounter Designer, editor tabs |
| F05 | Lobby & Session Lifecycle | not started | none — a hardcoded `DEBUG_PLAYER_EMAIL` escape hatch in `campaign-session/constants.ts` is not a lobby | Needs a real multiplayer membership model first |
| F06 | Adventure Page (Live Play Frontend) | early scaffold | `frontend/src/features/campaign-session/` | Needs `scene.mode` state machine, tactical grid, VN layout, Player/DM sidebars |
| F07 | Live Orchestration Core | early scaffold | `backend/campaign/session_handlers.py`, `narration.py` | Needs Action Router, Adjudicator, single-writer Adventure Manager + `state_version`, proposal lifecycle, Consistency pass |
| F08 | Story & Loop System | not started | one pacing counter (`storage.py: turns_since_last_plot_point`) | Everything: Loop Stack Manager, Loop Classifier, Beat Planner, Ingredient Pool, Hook Weaver, Meta Loop Steward |
| F09 | Combat Engine & Tactical Map | not started | none | Everything; depends on SRD data (Phase 0) |
| F10 | Social Encounter System | not started | flat `npcs` table re-injected into narration prompts — a seed for future NPC Agent context | Everything: VN dialogue mode, NPC Agent, disposition, influence checks |
| F11 | Progression System | not started | none | Everything; depends on SRD data (Phase 0) |
| F12 | Asset & Immersion Pipeline | partial | `backend/job_queue.py`, `backend/tts.py`, audio chunk player (see §4) | Image gen (none exists), voice profile upload/cloning, music/ambience; migrate TTS to spec's gateway model if §3 item 1 requires it |
| F13 | Memory & RAG | early scaffold | `backend/campaign/extraction.py` (flat NPC/lore extraction, no embeddings) | Embedding pipeline (Qwen3 -> pgvector), `query_lore`, Summarizer, spoiler gating |
| F14 | Full-AI DM Mode | not started | none | Gated on F15 trust data per `DEVELOPMENT-PLAN.md` PHASE 9 — do not start early |
| F15 | Observability & Telemetry | early scaffold | `backend/timing.py`, `frontend/src/lib/job-timer.ts`, `backend/data/usage.json` (flat, not per-trace) | Needs persisted per-trace logging (`proposal_log`, `incidents`), dashboards |

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
