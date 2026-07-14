# TASK.md — Deferred work (backlog)

Captured while building the core campaign generation flow (setup → plot → outline → save).
Nothing here is implemented yet.

## Campaign list / detail

- The "Your campaigns" home page card is still a static placeholder — needs a real campaign list
  backed by the `campaigns` table.
- Campaign detail/view page for a saved campaign.

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

## Narration audio (TTS)

Implemented but never confirmed working end-to-end — this dev machine has no NVIDIA GPU (CPU
fallback added in `backend/tts.py`) and only ~7GB RAM, too tight to reliably load the ~4GB
chatterbox-turbo model for real testing. Pick this up on a machine with more headroom. Relevant
code: `backend/tts.py`, `backend/supabase_storage.py`, `backend/campaign/session_handlers.py`
(`make_handle_generate_turn`, `make_handle_publish_turn`), `frontend/.../hooks/use-live-narration-audio.ts`
and `use-audio-chunk-player.ts`.

- Run `uv run main.py`, then exercise the DM generate → publish flow with `campaign-page.tsx` open
  and confirm: transition narration plays first and finishes before real narration starts,
  sentences play back-to-back with natural pauses (longer between paragraphs), it autoplays
  without a click, and the "▶ Play narration" replay button on published turns works.
- Confirm the `norm_loudness=False` workaround in `tts.py` (for
  <https://github.com/resemble-ai/chatterbox/issues/499> — a numpy≥2.0 type-promotion bug) actually
  resolves the "expected scalar type Double but found Float" error in practice — never got a clean
  confirming run locally.
- On an actual NVIDIA GPU, confirm the `torch.cuda.is_available()` auto-detect in `tts.py` picks
  CUDA and generation is fast enough per sentence to feel real-time.
- Known, deliberately-accepted-for-now limitations: if the DM heavily edits a draft before
  publishing, the persisted audio (regenerated from the final text) will differ from what played
  live during drafting; turns get TTS'd twice on the common path (live preview + publish
  persistence); no cleanup job for the ephemeral `drafts/...` Storage objects; browser autoplay
  policy could in theory block the live audio in some circumstances.

## Ops

- SPA history-mode fallback config for production hosting of the `react-router-dom` routes (the dev
  server handles deep links automatically; static production hosting needs an explicit rewrite
  rule so refreshing `/campaigns/new` doesn't 404).
