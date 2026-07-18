=== CHECKPOINT: F01 — Auth, Settings & AI Connectivity ===

BUILT:

- 6 migrations, applied and live on the real project: `profiles` + `user_settings` (with a
  `handle_new_user()` trigger that auto-provisions both on signup), `user_api_keys` (Vault-backed,
  not hand-rolled pgsodium), `usage_log`, `worker_tokens` + `worker_status`,
  `openrouter_credit_cache`. RLS on every table.
- 4 Edge Functions deployed: `ai-proxy` (JWT verify, per-role model resolution against MAIN-SPEC
  §4.7 defaults, `text` SSE passthrough, `tts`/`image`/`embedding` routing, `usage_log` insert,
  `LOCAL_MODE` rejection stub), `ai-credit` (60s DB-cached OpenRouter credit poll), `worker-token`,
  `worker-heartbeat`.
- Frontend: `features/settings/` (Provider / Model map / Media models / API keys / Worker token /
  Audio sections + a real narrator test box), a shared `Navbar` (credit meter, local-worker
  indicator, Settings link) replacing the inline header, `/settings` route.
- `docs/F01-...md` §2 updated for the OAuth-deferred decision; `docs/DECISIONS.md` new entry
  (model-catalog verification findings, TTS's real Phase-3 dependency, no-Deno-tooling call);
  `TASK.md` status moved to Phase 1 / F01 built-ungated.

Deviations from spec (flagged, not silent):

- BYOK own-key rotation (the actual `vault.create_secret` flow) isn't wired to a UI action — only
  the Advanced localStorage-acknowledgment toggle is. Low-risk to defer; the platform key covers
  every call today.
- Audio section volumes are local component state only, not persisted — the spec's own
  `user_settings` schema table has no columns for them, and nothing consumes them until F12.
- No Deno test tooling or CI changes were added, per your explicit direction mid-session. The pure
  model-routing/resolution logic is plain TypeScript (no Deno APIs), duplicated into
  `frontend/src/features/settings/model-routing.ts`, and unit-tested there with the existing
  Vitest setup. RLS cross-user denial is a plain Node script
  (`tests/integration/rls-cross-user.mjs`) run directly against the real project, not a CI job.
- `ai-credit`'s 60s cache is a DB row, not in-memory — edge functions are stateless/scale-to-zero
  between invocations, so in-memory caching wouldn't have worked anyway.

AI TESTS:

- `npm run lint` — 0 errors. `npm run test` — 3 files / 11 tests pass (includes new
  `resolveModel`/`isAgentRole`/`AGENT_ROLE_LABELS` suite and `getWorkerStatusLevel` threshold
  suite). `npm run build` — typecheck + production build clean.
- `tests/integration/rls-cross-user.mjs` — PASS. Confirms cross-user denial across `profiles`,
  `user_settings`, `user_api_keys`, `usage_log`, `worker_tokens`, `worker_status` (own-row reads
  succeed; a second user's reads of the first user's rows return zero rows, not an error —
  correct Postgres RLS behavior).
- Real end-to-end smoke test (ad hoc script against the live project, two throwaway users created
  and deleted via the Admin API): signup → `handle_new_user()` trigger fired (profile +
  user_settings rows appeared) → real streamed `agent_role: narrator` call through `ai-proxy`
  (resolved to system default `xiaomi/mimo-v2.5` since `model_map` was empty) → a `usage_log` row
  appeared with correct model/role/kind/cost/latency within ~1.5s of stream completion.
- OpenRouter model catalog verified per-model (not guessed) via `/api/v1/models/{id}/endpoints` —
  see the table in `docs/DECISIONS.md`'s new entry. All 8 curated models across
  text/TTS/image/embedding are real, live endpoints.
- Total real OpenRouter spend across every test this phase: **$0.0000354** (of the $1 authorized
  budget) — text streaming probe $0.0000211, end-to-end smoke test $0.0000143, all TTS probe
  attempts $0 (validation/lookup errors before any generation occurred).

COULD NOT VERIFY:

- TTS streaming-vs-buffered behavior for `kind: tts` — OpenRouter's `/api/v1/audio/speech`
  endpoint requires a `voice_id` from a cloned voice profile; there is no built-in voice to test
  with. This is `DEVELOPMENT-PLAN.md` PHASE 3's "upload a narrator voice clip" task, not something
  fakeable now — see `docs/DECISIONS.md`. `ai-proxy`'s `tts` branch is wired against the real,
  documented request/response shape (confirmed via OpenRouter's docs), just not exercised
  end-to-end yet.
- `kind: image` and `kind: embedding` routes are wired against real, confirmed endpoints but not
  live-tested — image quality judgment is F2's job; embeddings aren't consumed until F13.
- Whether the local-worker heartbeat indicator looks right in an actual browser session — the
  green/yellow/red threshold function is unit-tested, but I didn't drive a real browser through it.
- Whether the Settings page's layout/information density is good — a taste call, not automatable.

YOUR TESTS:

- [x] Sign up a new account at `/`, then in the hosted Supabase Studio confirm a `profiles` row
      and a `user_settings` row exist for that user (auto-created by the trigger).
- [x] Go to `/settings`, use the "Test the AI gateway" box, confirm streamed text appears and the
      navbar credit figure shows a real number (not "—").
- [x] In Studio, confirm a new `usage_log` row appeared for that call within a few seconds, with
      `model = xiaomi/mimo-v2.5`, `agent_role = narrator`, `kind = text`, nonzero `cost_usd`.
- [x] Change a role's model in the Model map section, re-run the test box, confirm the new model
      shows up in the next `usage_log` row's `model` column.
- [x] Switch Provider to "Local server", re-run the test box, confirm it fails with a clear
      `LOCAL_MODE` error rather than hanging or crashing.
- [x] Click "Generate worker token" in the Local server section, confirm a token displays once.
- [x] Run `node tests/integration/rls-cross-user.mjs` from the repo root yourself and confirm it
      prints `PASS`.

YOUR TASKS:

- [x] Confirm the OpenRouter spend limit is still what you expect — you regenerated the key
      mid-session (the matching box on `docs/CHECKPOINTS/PHASE0.md` is still unchecked pending
      this, since it referred to the old, invalid key).
- [x] Decide whether to revoke the `SUPABASE_ACCESS_TOKEN` and `OPENROUTER_API_KEY` values you
      pasted into `frontend/.env.local` this session, or leave them (gitignored, but shared over
      chat during this conversation).
- [x] When you're ready to test TTS for real (Phase 3), you'll need to record/upload a 2-3s voice
      clip — Voxtral Mini TTS has no built-in voice to test with.

DESIGN REVIEW:

- [x] Is a Settings page with 6 stacked sections + a test box the right shape, or should some of
      this (worker token, audio) move to their own tabs/pages before more accumulates? NOTES: Own tabs please.
- [x] OK to leave BYOK own-key rotation (the actual Vault-backed "store my OpenRouter key" flow)
      unbuilt for now, with only the Advanced-toggle acknowledgment wired?
- [x] Comfortable leaving `kind: tts` functionally unverified until Phase 3 provides a real voice
      clip, per the reasoning above and in `docs/DECISIONS.md`?

GATE: PASS
