# F15 — Observability & Balancing Telemetry

**Depends on:** logging hooks in F1, F7, F9 (built from day one); dashboards last
**Depended on by:** F14 readiness gate; ongoing tuning of every agent and the difficulty system

## 1. Purpose

Turn the system's own logs into the instruments that answer: which agents are trustworthy, what does play cost, is combat balanced, and what went wrong — including deterministic replay.

## 2. Data sources (all specified in earlier features — this spec consumes them)

- `proposal_log` (F7): every AI proposal + decision + edit diff
- `usage_log` (F1): per-call model, tokens, cost, latency
- `event_log` (F7): every resolved action
- `incidents` (new): consistency violations, schema failures, degradation-ladder rungs, poison jobs
  `incidents: id, adventure_id?, severity, component, kind, detail jsonb, created_at`
- Combat events (F9): structured per-round data

## 3. Agent trust analytics

Per agent role, rolling windows (50/200 proposals):

- Acceptance rate (accepted unedited / total), edit rate with **edit-distance buckets** (cosmetic <10% chars changed vs substantive), rejection rate
- Confidence calibration (Loop Classifier: acceptance rate per confidence band — is 0.8 really 0.8?)
- Post-hoc contradiction rate: accepted proposals later linked to a consistency incident
- Latency p50/p95 per role → feeds model-map tuning
Surface: creator-facing "AI performance" panel per adventure + a system dashboard (admin). These metrics ARE the F14 readiness gate inputs.

## 4. Cost analytics

- Per adventure: lifetime + per-session cost, broken down by agent role and kind (text/tts/image/embedding) — from usage_log rollup views.
- Session-end card (F5) shows the creator "this session cost $X.XX"; adventure page shows cumulative.
- Anomaly flag: session cost > 3× the adventure's rolling median → incident (runaway loop detection).

## 5. Combat balance telemetry

Per combat encounter, computed at end from combat events:

```text
combat_metrics: combat_id, party_level_avg, effective_party_size (allies weighted),
                budget_rating, difficulty_setting, rounds, duration_min,
                party_hp_swing_pct (max party HP lost at worst moment),
                death_saves_rolled, pc_deaths, enemy_actions_wasted,
                tactician_calls, outcome,
                combos_triggered, momentum_earned, momentum_spent,
                paired_mechanics_resolved
```

Aggregations answer: does "Hard" actually produce ~Hard outcomes (target bands: Standard → 20–40% hp swing, Hard → 40–65%, Deadly → 65%+ with death saves)? Deviations feed manual tuning of the Difficulty Scaler presets (data-informed constants, not auto-tuning in v1).

### 5.1 Cooperation telemetry (min_players > 1)

Per session, from the event log: assists claimed vs offered, group checks run, braided beats resolved, coop sets completed vs placed, social openings emitted vs consumed, party-asset decisions, spotlight distribution (intent share per player). Answers: are cooperation mechanics being *used* or ignored (consumed/offered ratios), is any player structurally sidelined (spotlight Gini over sessions), and does the Variety Manager's coop balancing actually converge (flag frequency trend). These feed tuning of the density guardrails (F4 §4.1, F8 §7) — same philosophy as combat balance: data-informed constants, not auto-tuning.

## 6. Replay & debugging

- **Deterministic replay:** seeded Dice Engine + append-only event log + intent log ⇒ any combat or session segment re-executable in a sandbox to reproduce bugs. `replay(adventure_id, from_checkpoint, to_event)` dev tool.
- **Proposal inspector (dev/admin):** view any proposal with its full assembled agent context (requires storing context snapshots for a sampled % of calls — default 10%, 100% in staging) — the tool for diagnosing "why did the agent say that".
- Trace IDs: intent_id propagated through router → agent calls → proposals → diffs → broadcasts, so one player action is one queryable trace.

## 6.1 Adventure Lab — simulated playthroughs (built 2026-07-22)

The pre-production counterpart to replay: instead of re-running a recorded session, the Lab
*generates* one. It exercises the real guide pipeline and the real live-play loop end to end
with an LLM standing in for the players, at roughly **$0.02 per run** — cheap enough that a
behavioural regression is caught by playing the game, not by reading code.

**Architecture (deliberate three-part split):**

- **`/adventure-lab`** (email-gated page) only *enqueues* `lab_runs` rows and observes. It never
  calls an adventure or play API.
- **A local watcher** (`node tests/lab/lab-runner.mjs`) claims queued runs **one at a time** and
  executes: throwaway users → guide generation (with retry/stall-nudge) → simulated play →
  analysis. It holds the service key and writes files, which a browser cannot.
- **`lab_run_events`** is the live log the page tails (incremental by id), and
  **`lab_comments`** are the user's pinned annotations — attached to a specific log row — which
  are read back during review so a human observation made *during* the run guides the debugging
  afterwards.

**Decoupling contract:** the page renders generic `{phase, fn, label, detail}` rows and holds no
knowledge of the pipeline. All system knowledge lives in `tests/lab/*.mjs`. Changing the
creation or play flow must never require a frontend change — new event kinds flow through
untouched. (User requirement, 2026-07-22.)

**The simulated player** (`tests/lab/player-agent.mjs`) reads the actual narration and replies at
a chosen quality — `poor | mediocre | good | mixed` (mixed samples 30/40/30 per turn from a
per-run seeded RNG, so a rerun replays the same schedule). This is what makes the Lab able to
catch pacing bugs: a canned turn list can never fail to answer a quest offer, get lost, or
follow a thread.

**Artifacts per run:** `tests/lab/logs/<run-id>.jsonl` (every step with `fn`, timestamp,
duration, detail; game `event_log` rows mirrored as `game.<type>`) and `<run-id>.summary.json`
(pacing counts, incidents, silent turns, spend by agent role, full transcript). Gitignored.

**Findings it produced that unit tests structurally could not** (all fixed, see
`docs/DECISIONS.md` 2026-07-23): the permanently-unwinnable dungeon; a 35-turn unanswered quest
offer; offer pressure firing on three consecutive turns; an offer ladder with no terminal step
(6 presses, 0 objectives across 30 turns); and a planner emitting bare `{"flag":"x"}` that
hard-failed whole beats. **Rescue-rung firings (`guaranteed_route`, `fail_forward`) are tracked
as lab anomalies** — a healthy run should never reach them; a run that does indicates an
upstream defect the ladder is masking.

## 6.2 Pre-deploy boot gate

`supabase functions deploy --use-api` neither typechecks nor module-loads the bundle. A
duplicate import therefore deployed cleanly and returned `503 BOOT_ERROR` on every request
until it was found by hand (2026-07-23).

`node scripts/check-functions.mjs [name]` boots each edge function under Deno (~2s each) and
fails on load errors — duplicate identifiers, bad named imports, top-level throws. Type errors
are deliberately **not** fatal (the repo carries known strictness noise that the runtime
strips; only *load* failures boot-fail). Run it before every deploy.

## 7. Incident handling

- Severity: `info` (retry succeeded), `warn` (fallback model used, consistency regeneration), `error` (rung-3 degradation, poison job, contradiction reached players).
- Creator notification for `error` in their adventures (in-app). Admin dashboard: incident stream with component filters.

## 8. Dashboards (build order: views first, UI last)

1. Postgres views + a `/debug` JSON endpoint (week 1 of the project — free once logs exist)
2. Creator-facing panels (AI performance, costs) on the adventure detail page
3. Admin dashboard (agent trust, incidents, combat balance) — simple internal page, not a product surface

## 9. Acceptance criteria

- [ ] Every proposal, call, and resolved action carries a trace id; a single intent is reconstructable end-to-end.
- [ ] Trust metrics computed correctly against a seeded proposal_log fixture (known rates in → known rates out).
- [ ] Replay of a recorded combat reproduces identical event logs (byte comparison).
- [ ] Cost anomaly flag fires on a synthetic runaway session.
- [ ] Combat metrics land for every completed encounter; difficulty-band report renders.
- [ ] Context snapshots sampled and viewable in the proposal inspector.

## 10. Open questions

- Privacy/retention: context snapshots contain gameplay text — retention 30 days default, creator-deletable with the adventure.
- Whether to expose combat balance data to DMs as an in-product "encounter difficulty report" — nice v1.1 feature, the data will already exist.
