# dungeon-crawler

Two independent subprojects, no shared code between them:

- **frontend/** — React 19 + Vite + TypeScript SPA backed by Supabase. Organized per
  bulletproof-react conventions — see [frontend/CLAUDE.md](frontend/CLAUDE.md) for the structure
  and conventions before adding or moving frontend code.
- **backend/** — Python (uv-managed) Discord bot (`main.py`) with TTS/STT.

There is no top-level build tying the two together; work in each directory independently.
