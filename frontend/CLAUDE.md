# Frontend

React 19 + Vite + TypeScript SPA, using Supabase as the backend-as-a-service. Organized per [bulletproof-react](https://github.com/alan2207/bulletproof-react) conventions.

## Structure

```text
src/
  app/          Root App component + its styles (app.tsx, app.css). No routing yet.
  components/   Shared UI components used by 2+ features. Empty until that's needed —
                don't add a component here unless something outside a single feature uses it.
  config/       Centralized env var access (env.ts). Never call import.meta.env directly
                outside this file — add new vars here first.
  features/     One folder per feature/domain. Each feature owns its full vertical slice:
                  api/         data-fetching functions (plain async fns wrapping supabase calls)
                  hooks/       React hooks that call the api/ functions and hold local state
                  components/  presentational components that consume the hooks
                  types.ts     types local to this feature
                  index.ts     barrel file — the ONLY entry point other code should import from
                Other code (app/, other features) must import via the feature's index.ts,
                never reach into features/x/components/... directly.
  lib/          Thin wrappers around third-party libraries, pre-configured for this app
                (e.g. lib/supabase.ts exports a configured Supabase client).
  main.tsx      Vite entry point.
```

## Conventions

- **Path alias**: use `@/` for all cross-folder imports (e.g. `@/features/notes`, `@/lib/supabase`).
  Configured in both `tsconfig.app.json` (`paths`) and `vite.config.ts` (`resolve.alias`) — keep them in sync.
- **File naming**: kebab-case filenames (`notes-list.tsx`), PascalCase component names, named exports
  (not default exports) except for `app/app.tsx` and `main.tsx`.
- **No react-query yet**: data fetching uses plain `useState`/`useEffect` hooks in `features/*/hooks`.
  If fetching needs grow (caching, retries, mutations), introduce `@tanstack/react-query` and move
  the fetch functions in `api/` under it rather than hand-rolling more of that logic.
- **Adding a new feature**: create `features/<name>/` with the same api/hooks/components/index.ts
  shape as `features/notes`. Don't create empty subfolders speculatively — only add `api/`, `hooks/`,
  etc. once the feature actually needs them.
- **Env vars**: add new `VITE_*` vars to `.env.local`, declare them in `src/vite-env.d.ts`
  (`ImportMetaEnv`), and expose them through `src/config/env.ts`.
- **Job timing**: wrap any async call that talks to the backend (Supabase Realtime signals, and
  later text/audio/image generation requests) in `timeJob` from `lib/job-timer.ts` so round-trip
  duration is logged consistently — see root `CLAUDE.md` for the full convention.

## Commands

- `npm run dev` — start dev server
- `npm run build` — typecheck (`tsc -b`) + production build
- `npm run lint` — eslint
