# dungeon-crawler

Two independent subprojects, no shared code between them:

- **frontend/** — React 19 + Vite + TypeScript SPA backed by Supabase. Organized per
  bulletproof-react conventions — see [frontend/CLAUDE.md](frontend/CLAUDE.md) for the structure
  and conventions before adding or moving frontend code.
- **backend/** — Python (uv-managed) Discord bot (`main.py`) with TTS/STT.

There is no top-level build tying the two together; work in each directory independently.

## Client ↔ backend communication

The frontend and backend talk over Supabase Realtime broadcast channels — the backend only
makes outbound connections (no public endpoint to expose), so it works fine running on a local
machine behind NAT. See `frontend/src/features/realtime-test/` and
`backend/tests/realtime_signal.py` for a minimal ping/pong example.

**Every** request that crosses the client/backend boundary (the realtime signal test now; text,
audio, and image generation jobs later) must be timed with the shared job-timer utility on both
sides, so job durations are logged consistently and comparably:

- Frontend: `timeJob` in `frontend/src/lib/job-timer.ts` — wrap the async call that sends the
  request and awaits the response.
- Backend: `time_job` in `backend/timing.py` — wrap the work done to handle the request and send
  the reply.
