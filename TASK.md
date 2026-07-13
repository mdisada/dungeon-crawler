# TASK.md — Deferred work (backlog)

Captured while building the core campaign generation flow (setup → plot → outline → save).
Nothing here is implemented yet.

## Outline editing & locking

- Per-chapter and per-session lock icons/toggles in the outline view.
- Manual editing UI for chapter/session fields (title, big goal, twists, hook, conflict/climax,
  cliffhanger).
- "Regenerate" that respects locked chapters/sessions (regenerate only the unlocked ones).
- Wire the `locked` columns (already present in the SQLite schema) up to real UI/API writes.

## Campaign list / detail

- The "Your campaigns" home page card is still a static placeholder — needs a real campaign list
  backed by the `campaigns` table.
- Campaign detail/view page for a saved campaign.
- Campaign title (generation or manual entry) — the `campaigns.title` column exists but is unused.

## Discord bot integration

- Wire the `campaign` handlers into the real Discord bot flow / `backend/main.py` (currently only
  reachable via the standalone `backend/tests/campaign_builder.py` script).

## Gameplay

- Multiplayer / choose-your-own-adventure session runner.
- Turn/session progression through a saved campaign.
- Memory systems across sessions (world state, past choices, NPC memory).

## World knowledge

- RAG-based world knowledge (chunking/embeddings) instead of flat concatenation of all files.
- Cache the concatenated world-knowledge string instead of re-reading files per request, if the
  corpus grows.

## LLM / generation robustness

- Outline bounds: a basic retry/repair loop is in place (`_MAX_OUTLINE_ATTEMPTS` in
  `campaign/manager.py` — regenerates, feeding the specific violation back, before failing).
  Still worth: smarter repair (e.g. trim/pad only the offending chapter instead of a full
  regenerate) and surfacing "took N attempts" to the client.
- Verify structured-output parity between the OpenRouter path (`response_format`) and the Ollama
  path (native `format`) — Ollama's support is more limited; confirm reliability once used more.
- Automated tests for `campaign` handlers / storage (no test suite convention exists yet in this
  repo — only manual scripts under `backend/tests/`).

## Ops

- SPA history-mode fallback config for production hosting of the `react-router-dom` routes (the dev
  server handles deep links automatically; static production hosting needs an explicit rewrite
  rule so refreshing `/campaigns/new` doesn't 404).
