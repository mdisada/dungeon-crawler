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
```
combat_metrics: combat_id, party_level_avg, effective_party_size (allies weighted),
                budget_rating, difficulty_setting, rounds, duration_min,
                party_hp_swing_pct (max party HP lost at worst moment),
                death_saves_rolled, pc_deaths, enemy_actions_wasted,
                tactician_calls, outcome
```
Aggregations answer: does "Hard" actually produce ~Hard outcomes (target bands: Standard → 20–40% hp swing, Hard → 40–65%, Deadly → 65%+ with death saves)? Deviations feed manual tuning of the Difficulty Scaler presets (data-informed constants, not auto-tuning in v1).

## 6. Replay & debugging
- **Deterministic replay:** seeded Dice Engine + append-only event log + intent log ⇒ any combat or session segment re-executable in a sandbox to reproduce bugs. `replay(adventure_id, from_checkpoint, to_event)` dev tool.
- **Proposal inspector (dev/admin):** view any proposal with its full assembled agent context (requires storing context snapshots for a sampled % of calls — default 10%, 100% in staging) — the tool for diagnosing "why did the agent say that".
- Trace IDs: intent_id propagated through router → agent calls → proposals → diffs → broadcasts, so one player action is one queryable trace.

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
