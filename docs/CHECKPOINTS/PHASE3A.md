=== CHECKPOINT: F03 — Adventure Creation Wizard (Phase 3a) ===

BUILT:

- `adventures` table (`supabase/migrations/20260717180000_create_adventures.sql`) with creator-only
  RLS (select/insert/update/delete) and DB-level check constraints mirroring the wizard's bounds
  (players 1–8, min ≤ max; chapters 2–12, min ≤ max; mode/type/status enums). Applied live
  (`db push --dry-run` clean first, then pushed) and verified by the new integration test below.
- `frontend/src/features/adventures/` vertical slice: single page at `/adventures/new` with the
  four F03 §3 sections top-to-bottom — mode cards (Full-AI with v1-limits badge + difficulty
  select defaulting Standard, AI-Assist), player min/max steppers (clamped against each other so
  an invalid range can't be entered), adventure type cards (multi-chapter reveals a dual-handle
  chapter slider, bounds 2–12), and the plot section (autosizing textarea capped at 2,000 chars,
  context-sensitive Generate/Improve button, undo/redo, previous-ideas dropdown). CTA validates
  and flips the row to `generating`.
- Autosave, debounced 1s per spec, of every field including the undo history
  (`plot_history`). `/adventures/new` resumes the user's most recent `status='draft'` row.
- Plot AI calls run as `agent_role: story_director` through the existing `ai-proxy` (non-streaming,
  same shape as F02's background narrative). Improve-prompt carries the spec's proper-noun
  retention constraint; both prompts carry the type/chapter-range context.
- Undo/redo as a pure snapshot-stack module (`plot-history.ts`: commit/undo/redo/cap-25/normalize)
  with the CTA validation in a second pure module (`adventure-validation.ts`) — both unit-tested.
- New shared UI primitive `components/ui/slider.tsx` (wraps `@base-ui/react/slider`, same pattern
  as `progress.tsx`), used for the dual-handle chapter range.
- `/adventures/:id` minimal status page: shows the queued-for-generation state and the draft
  summary. The real F4 pipeline progress/editor replaces it in Phase 3b — deliberately not
  scaffolded further (rule zero).
- Home page "New adventure" card; the old prototype "New campaign" card/routes are untouched
  (still reference material for F04 per TASK.md §4).
- `tests/integration/rls-adventures.mjs` (mirrors `rls-characters.mjs`; also asserts the
  previous-ideas query shape can't surface another user's plots).

Deviations from spec (flagged, not silent):

- **`plot_history` is one jsonb object `{ entries, index }`, not the spec's `jsonb[]`** — carrying
  the cursor means redo (not just undo) survives reload.
- **Draft reuse instead of draft-per-visit:** the spec doesn't say what happens on a second visit
  to `/adventures/new`; resuming the most recent un-generated draft is what makes "reload restores
  all fields" true at a stable URL. Multiple parallel drafts have no UI until an adventures list
  exists (F5 lobby era).
- **CTA is disabled until valid, with a hint line listing what's missing** — the spec's "if empty,
  prompt: 'Generate a plot first, or write one'" is rendered as that standing hint rather than a
  click-triggered prompt, per acceptance criterion 6's "before CTA enables" wording.
- **LLM contract returns plain prose, not JSON `{ plot }`** — same call shape as F02's narrative
  generation; avoids depending on structured-output support for the routed model.
- **Difficulty presets assumed as Easy/Standard/Hard/Deadly** (stored `{ preset }` in
  `difficulty_setting`) — F9's modifier-set detail isn't specced yet; this is just the seam.
- Previous-ideas is a popover listing full plot texts (click inserts as a new undo state) rather
  than a compact select — same behavior, more readable for paragraph-length entries.

AI TESTS:

- `frontend`: `npx tsc -b` (0 errors), `npx eslint .` (0 errors), `npm run test` — 26/26 pass
  (15 new: 10 plot-history — commit/no-op/redo-clearing/cap-and-drop-oldest/boundary
  undo-redo/normalize-junk; 5 validation — complete draft passes, missing mode/type/plot,
  Full-AI-requires-difficulty, player-range rejection, chapter-range rejection incl. min>max and
  out-of-bounds), `npm run build` clean.
- Migrations: `db push --dry-run` showed exactly the one new migration; applied live.
- `tests/integration/rls-adventures.mjs` — PASS live: cross-user select/update/delete all affect
  zero rows, forged insert (`creator_id` = other user) rejected, previous-ideas query returns
  nothing of user A's to user B, A's row confirmed unmodified.

COULD NOT VERIFY:

- Real `story_director` round trips — generate/improve quality, and whether the improve call
  actually retains proper nouns in practice (prompt-level constraint only). Each call is
  well under the $0.10 threshold (~500 output tokens on deepseek-v4-pro ≈ a fraction of a cent),
  but it spends real credit, so it's in YOUR TESTS instead.
- Dual-handle slider feel (keyboard arrows work per Base UI, verified by code review only).
- Draft resume + undo-history restore across a real browser reload (code path reviewed; the same
  autosave pattern F2 used, but not driven by hand).
- No RTL component tests for the wizard page/sections — same gap flagged on the F2 checkpoint;
  only the pure modules have coverage.

YOUR TESTS:

- [x] `npm run dev` in `frontend/`, sign in, click the "New adventure" card on Home — confirm
      `/adventures/new` loads with a "Saved" indicator top-right.
- [x] Pick **AI-Assist**, set players to 2–5, pick **Multi-chapter**, drag both chapter handles —
      then refresh the tab and confirm every choice (including the slider) is restored.
- [x] Switch type to **One-shot** — confirm the chapter slider disappears.
- [x] Pick **Full-AI DM** — confirm the difficulty select appears, already set to Standard, and
      the v1-limitations badge reads correctly.
- [x] With the textarea empty, click **Generate plot** (spends well under $0.01 of real credit) —
      confirm 3–6 sentences of premise appear and the button label flips to **Improve plot**.
- [x] Click **Improve plot** — confirm the text is rewritten, then Undo steps back to the
      generated version, Undo again to empty, Redo twice forward. Check any named people/places
      survived the improve pass.
- [x] Type a manual edit, click outside the textarea (blur), then Undo — confirm your edit
      reverts.
- [x] Refresh the tab, then press Undo — confirm the history still traverses the same states.
- [x] Fill everything in and click **Generate Adventure Guide** — confirm you land on
      `/adventures/:id` showing the queued-for-F4 status and your setup summary.
- [x] Visit `/adventures/new` again — a fresh draft; open **Previous ideas** and confirm your
      first adventure's plot is listed and clicking it inserts it (and Undo removes it again).
- [x] Run `node tests/integration/rls-adventures.mjs` from the repo root and confirm `PASS`.

YOUR TASKS:

- [x] None for 3a — no new accounts, keys, or media needed. (Phase 3b is the heavy one: full
      pipeline run authorization, narrator voice clip, map designs.)

DESIGN REVIEW:

- [x] CTA behavior: disabled-until-valid with a standing "what's missing" hint line, instead of
      the spec's click-then-prompt — keep it?
- [x] Draft lifecycle: `/adventures/new` always resumes your latest un-generated draft; you can't
      keep several drafts in flight until a list page exists. Fine for now, or do you want a
      "start fresh" escape hatch on the page before this gates?
- [x] Difficulty vocabulary for Full-AI: Easy / Standard / Hard / Deadly as the F9 seam — right
      names?
- [x] Default chapter range for a new multi-chapter pick is 4–8 (bounds 2–12) — feel right?

GATE: PASS
