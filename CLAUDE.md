
# Dungeon Crawler — Claude Code Instructions

## Identity

You are working on a production React application. Follow modern React best
practices (2025+). Write clean, maintainable, type-safe code. Prioritize
correctness, readability, and accessibility. Do not over-engineer.

---

## Output and Efficiency

- Organized per bulletproof-react conventions — see [frontend/CLAUDE.md](frontend/CLAUDE.md) for the structure and conventions before adding or moving frontend code.
- Return code first. Explanation after, only if non-obvious.
- No sycophantic openers, closing fluff, or restating the question.
- No unsolicited suggestions or boilerplate beyond the requested scope.
- Read before writing. One focused pass — avoid write-delete-rewrite cycles.
- If unsure, say so. Never guess or invent file paths.
- Code output is ASCII only (plain hyphens, straight quotes) — copy-paste safe.
- Code review: state the bug, show the fix, stop.
- Debugging: read the code first. State what you found, where, and the fix.
- User instructions always override this file.

---

## Code Quality Rules

### General

- Write the simplest code that solves the problem. No speculative abstractions.
- **Minimal runtime cost.** When choosing between libraries of equivalent functionality, prefer the lighter option. A 3 KB dependency that covers your use case beats a 30 KB one with features you will never use. Check `bundlephobia.com` before adding any dependency.
- One component per file. Name the file the same as the component (PascalCase).
- Keep files under 200 lines. If a file exceeds this, split by responsibility.
- Do not add comments that restate the code. Only comment non-obvious "why".
- Do not add JSDoc to every function. Only document public APIs and complex logic.
- Remove dead code. Do not comment it out or keep it "for reference."
- Use `const` by default. Only use `let` when reassignment is required.
- Prefer early returns over nested conditionals.
- Do not use `var`. Ever.
- Do not use `enum`. Use `as const` objects or union types instead.

### Naming

- Components: `PascalCase` (`UserProfile.tsx`)
- Hooks: `camelCase` starting with `use` (`useAuth.ts`)
- Utilities: `camelCase` (`formatDate.ts` or `date.utils.ts`)
- Types/Interfaces: `PascalCase` (`UserProfile`, `ApiResponse`)
- Constants: `UPPER_SNAKE_CASE` (`MAX_RETRY_COUNT`)
- Boolean props/state: prefix with `is`, `has`, `should`, `can` (`isLoading`, `hasError`)
- Event handlers: prefix with `handle` (`handleSubmit`, `handleClick`)
- Event handler props: prefix with `on` (`onSubmit`, `onClick`)

---

## TypeScript Rules

### Strictness

- **Always** use `strict: true` in tsconfig. Never disable it.
- **Never** use `any` unless interfacing with an untyped third-party library. If you must, add a `// eslint-disable-next-line` with a comment explaining why.
- Use `unknown` instead of `any` when the type is genuinely unknown.
- Enable and respect `noImplicitAny`, `strictNullChecks`, `noUnusedParameters`.

### Types and Interfaces

- Use `interface` for component props (extensible by consumers).
- Use `type` for unions, intersections, and computed types.
- Do not use `React.FC` or `React.FunctionComponent`. Type props directly on the function signature.
- Use `React.ReactNode` for children props (broad — accepts strings, elements, fragments).
- Use discriminated unions (`{ status: 'idle' } | { status: 'success'; data: User }`) for state that can be in distinct modes.
- Implement exhaustive switch guards for union types via a `never`-typed helper.
- Leverage type inference. Do not annotate what TypeScript can infer.

### Event Types

- Use proper React event types:
  - `React.FormEvent<HTMLFormElement>` for form submission
  - `React.ChangeEvent<HTMLInputElement>` for input changes
  - `React.MouseEvent<HTMLButtonElement>` for click events
  - `React.KeyboardEvent<HTMLElement>` for keyboard events

---

## Component Rules

### Structure

- Keep components focused on a single responsibility.
- Prefer composition over configuration — pass `children` or element props instead of complex config objects. Let consumers control layout rather than anticipating every variation in a parent component's props.
- Extract logic into custom hooks when a component does too much. A component should orchestrate and render; data-fetching, transforms, and business logic belong in hooks.
- Place derived/computed values inline (during render), not in state or effects.

### Props

- Do not pass more than 5-7 props. If more are needed, group related props into an object or split the component.
- Always destructure props in the function signature.
- Provide default values via destructuring, not `defaultProps`.
- Never spread unknown props (`{...rest}`) onto DOM elements unless building a design system primitive.

### Conditional Rendering

- Use early returns for loading/error states at the top of the component instead of nested ternaries.
- Use `&&` for simple conditionals, ternary for if/else.
- For complex conditions with 3+ branches, use a lookup object or helper function.
- **Never** render `{count && <Component />}` when `count` can be `0` — it renders `0`. Use `{count > 0 && ...}` instead.

### Lists

- **Always** use a unique, stable `key` (usually `item.id`).
- **Never** use array index as `key` for dynamic lists (lists that can be reordered, filtered, or modified). Index keys cause state-preservation bugs when the list changes.
- Index as key is acceptable only for static lists that never change.

---

## State Management Rules

### Decision Tree (follow this order)

1. **Server data** (API responses) → Use SWR or TanStack Query. **NEVER** copy server data into `useState`, `useReducer`, or Redux.
2. **Local UI state** (one component: toggle, input value) → `useState`
3. **Complex local state** (related values, state machine) → `useReducer`
4. **Shared state** (2+ components need it) → Lift state to closest common parent first. If prop drilling exceeds 2 levels, use React Context.
5. **App-wide complex state** → Zustand (preferred) or Redux Toolkit
6. **Persistent state** (localStorage) → Custom `useLocalStorage` hook

### State Principles

- Keep state as local as possible. Only lift when necessary.
- Never store derived/computed values in state. Calculate during render, or wrap in `useMemo` if the computation is expensive.
- When updating state based on previous value, always use the function form (`setCount(prev => prev + 1)`).
- Use discriminated unions instead of multiple boolean flags for state modes.

### Context Rules

- **Always** wrap Context consumption in a custom hook with a null-check that throws if the provider is missing.
- Memoize context values with `useMemo` to prevent unnecessary re-renders of consumers.
- Scope providers as narrowly as possible. Do not wrap the entire app in every provider.

---

## Hooks Rules

### useEffect

- **Only use for synchronizing with external systems** (APIs, event listeners, timers, third-party libraries, DOM manipulation).
- **NEVER** use useEffect for:
  - Deriving state from props or other state (calculate during render)
  - Transforming data for rendering (calculate during render or useMemo)
  - Handling user events (use event handlers)
  - Chaining effects that trigger each other
- **Always** return a cleanup function when setting up subscriptions, timers, or event listeners.
- **Always** handle async operations safely to prevent state updates after unmount (use a `cancelled` flag or `AbortController`).
- Include all dependencies in the dependency array. Do not suppress the ESLint rule. If the effect runs too often, restructure the code.
- Be aware that useEffect fires twice in StrictMode (development). If your effect breaks, you are missing cleanup.

### useMemo and useCallback

- Use `useMemo` for expensive computations (filtering large arrays, complex calculations).
- Use `useCallback` for function references passed to memoized children.
- Do NOT wrap every value in useMemo or every function in useCallback. Only optimize when there is a measurable benefit or when passing to React.memo'd components.
- If the project uses React 19+ with the React Compiler, manual memoization is unnecessary — the compiler handles it.

### Custom Hooks

- Extract custom hooks when:
  - The same logic appears in 2+ components
  - A component is too complex and a hook improves readability
  - Logic needs to be tested independently of UI
- Each custom hook should have a single, clear responsibility.
- Name hooks descriptively: `useUserPermissions`, not `useData`.
- When creating 3+ data-fetching hooks with the same structure, extract a factory.

---

## Data Fetching Rules

- **Always** use a data-fetching library (SWR or TanStack Query). Never fetch in raw useEffect + useState — you lose caching, deduplication, background refresh, and it is race-condition prone.
- Configure sensible defaults:
  - `staleTime` / TTL: 5 minutes for most data
  - `shouldRetryOnError`: false for deterministic errors (404, 403)
  - Enable focus revalidation in production
- Use conditional fetching to prevent requests with incomplete parameters (SWR: `null` key pauses; TanStack Query: `enabled` option).
- Create typed wrapper hooks for every API endpoint — do not call SWR/Query directly in components.
- Handle loading, error, and empty states explicitly in every component that fetches data.

---

## Error Handling Rules

- **Always** add Error Boundaries via the `react-error-boundary` package. This is non-negotiable for production apps.
  - App-level: catches catastrophic failures
  - Feature-level: isolates crashes (e.g., sidebar crash does not kill main content)
  - List-item-level: one bad item does not collapse the list
- Provide recovery actions in error fallbacks (retry button, reload, navigate home).
- Log errors to a monitoring service (Sentry, DataDog) in the `onError` callback.
- Use try/catch in event handlers and async functions (error boundaries do not catch these). Surface errors to the user via toast notifications.
- Create a custom `ApiError` class that includes status code, endpoint, and parsed error messages.
- Show user-friendly error messages. Never expose raw error objects or stack traces.

---

## Performance Rules

### Mandatory

- **Route-level code splitting** with `React.lazy` and `Suspense`. Every route-level page component should be lazily loaded.

### Apply When Relevant

- `React.memo` on list item components and components that re-render due to parent context changes they do not consume.
- `useMemo` for expensive array filtering/sorting/transforming.
- Debounce rapid user inputs (search, resize, scroll) — 200-500ms.
- Use `useTransition` for non-urgent state updates that should not block the UI.

### Do NOT

- Wrap every component in React.memo, or every value in useMemo/useCallback by default. Only optimize measured bottlenecks.
- Prematurely optimize. Make it correct first, then fast.

---

## Styling Rules

### If Using Tailwind CSS

- Use `clsx` (or `clsx` + `tailwind-merge`) for conditional class composition. Create a `cn()` utility that combines both.
- Keep class strings on a single line when under ~80 characters. Break to multiple lines for longer strings.
- Use Tailwind's `@apply` sparingly — only for truly reusable base styles.
- Sort classes with `prettier-plugin-tailwindcss`.

### If Using CSS Modules

- Name files `Component.module.css` colocated with the component.
- Use `camelCase` for class names.
- Do not use global styles except in a single `global.css` entry point.

### Styling Across All Solutions

- Do not use runtime CSS-in-JS (styled-components, Emotion) in new projects. Use zero-runtime solutions (Tailwind, CSS Modules, Vanilla Extract).
- Do not use inline styles except for truly dynamic values (e.g., a computed width percentage).
- Use CSS custom properties (variables) for theme values, not JS constants.

---

## Accessibility Rules (Non-Negotiable)

- Use **semantic HTML**: `<button>` for actions, `<a>` for navigation, `<nav>`, `<main>`, `<header>`, `<footer>` for structure.
- **Never** use `<div onClick>` or `<span onClick>` for interactive elements — they are not focusable, keyboard accessible, or announced by screen readers.
- Every `<img>` must have an `alt` attribute. Use `alt=""` for decorative images; informative text for meaningful ones.
- Every interactive element must be **keyboard accessible** (Tab, Enter, Escape, Arrow keys).
- Every icon-only button must have `aria-label` describing its action.
- Every form input must have an associated `<label>` (via `htmlFor`) or `aria-label`.
- Use a headless/unstyled component library for complex interactive components (modals, dropdowns, comboboxes, tabs). Do not build these from scratch.

  | Library | Style | Best For |
  | --- | --- | --- |
  | **Headless UI** | Unstyled (hooks + components) | Tailwind projects, minimal footprint |
  | **Radix UI** | Unstyled primitives | Maximum flexibility, excellent docs |
  | **Ark UI** | Unstyled (state machines) | Framework-agnostic, Chakra successor |
  | **React Aria** | Hooks only | Most comprehensive a11y, Adobe-backed |
  | **shadcn/ui** | Pre-styled (Tailwind + Radix) | Rapid development, copy-paste components |

- Install and enforce `eslint-plugin-jsx-a11y` with the recommended config.
- Use `useId()` for generating unique IDs linking labels to inputs.

---

## Security Rules (Non-Negotiable)

- **NEVER** use `dangerouslySetInnerHTML` with user-provided content. If you must render HTML, sanitize with DOMPurify first.
- Enforce `react/no-danger: 'error'` in ESLint.
- Use `react-markdown` for rendering user-generated rich text.
- Validate and constrain all user inputs (max length, allowed characters).
- **Never** store auth tokens in `localStorage` for public-facing apps. Use HttpOnly cookies or in-memory storage.
- **Never** put secrets, API keys, or credentials in frontend code.
- **Never** interpolate user input into `href` attributes (prevents `javascript:` URL attacks).
- Run `npm audit` regularly. Address critical and high vulnerabilities.
- Use Content Security Policy headers in production.

---

## Project Structure Rules

### Directory Layout

Organize `src/` as: `api/` (client, error classes), `components/` (shared UI), `content/` (i18n strings), `contexts/` (domain-scoped providers), `hooks/` (shared hooks, with `hooks/data/` for SWR/Query wrappers), `pages/` (route components with feature-specific `components/` and `hooks/` subfolders), `router/` (routes, loaders, guards), `typings/` (shared types), and `utils/` (pure functions).

### Organization Principles

- **Colocate** feature-specific code within its page/feature directory.
- **Promote** to top-level (`src/hooks/`, `src/components/`) only when shared by 2+ features.
- One component per file. One hook per file (unless tightly coupled).
- Keep barrel files (`index.ts`) small (under 15 exports). Prefer direct imports for large projects.
- Enforce `import/no-cycle: 'error'` to prevent circular dependencies.
- Use `simple-import-sort` for consistent import ordering.
- Use path aliases (`@/components`, `@/hooks`) for clean imports.

---

## Testing Rules

### Requirements

- Every project must have tests. `passWithNoTests: true` is a red flag, not a feature.
- Use **Vitest** (for Vite projects) or **Jest** as the test runner.
- Use **React Testing Library** for component tests.
- Use **Playwright** for E2E tests of critical user flows.

### What to Test

1. **Integration tests** for critical user flows (highest value):
   - User can log in
   - User can complete the primary action (purchase, submit, join meeting, etc.)
   - Error states display correctly
2. **Unit tests** for:
   - Custom hooks
   - Utility functions
   - Complex business logic
3. **E2E tests** for:
   - The critical path (the one flow that must never break)
   - Cross-page flows involving navigation

### How to Test

- Test **behavior**, not implementation. Assert what the user sees, not internal state.
- Query elements by **role** first (`getByRole`), then **label** (`getByLabelText`), then **text** (`getByText`). Use `getByTestId` as a last resort.
- Use `userEvent` (not `fireEvent`) for interaction simulation.
- Use `screen` object for all queries.
- Do not test styled output, CSS classes, or component internal state.
- Do not write snapshot tests unless for very stable UI (icons, static content).

---

## Tooling Rules

### Required

- **TypeScript** in strict mode
- **ESLint** with these plugins:
  - `typescript-eslint/recommendedTypeChecked`
  - `eslint-plugin-react`
  - `eslint-plugin-react-hooks`
  - `eslint-plugin-jsx-a11y` (recommended config)
  - `eslint-plugin-simple-import-sort`
  - `eslint-plugin-import` (with `no-cycle: 'error'`)
- **Prettier** for formatting
- **Husky** + **lint-staged** for pre-commit quality gates

### ESLint Rules to Enforce

- `react/no-danger: error`
- `react/jsx-no-bind: error` (or warn; disable if using React Compiler)
- `import/no-cycle: error`
- `simple-import-sort/imports: error`
- `no-console: [warn, { allow: [warn, error] }]`

### Recommended

- `vite-plugin-checker` for real-time TS/ESLint overlay in dev
- `prettier-plugin-tailwindcss` for consistent class ordering
- React DevTools and SWR/Query DevTools during development

---

## Build and Deployment Rules

### Environment Variables

- **Never** hardcode API URLs, keys, or environment-specific values in source code. Use environment variables.
- Prefix client-exposed env vars correctly per framework (`VITE_` for Vite, `NEXT_PUBLIC_` for Next.js). Non-prefixed vars are server-only and will not be bundled.
- **Never** commit `.env` files with real secrets. Commit a `.env.example` with placeholder values as documentation.
- Use distinct `.env.development`, `.env.production`, `.env.staging` files when build-time configuration differs per environment.

### Build Output

- **Never** ship source maps to production unless behind authentication. They expose your source code.
- **Never** publish source maps to NPM. Use the `files` field in `package.json` or `.npmignore` to exclude `*.map` files.
- Enable bundle analysis periodically (`vite-bundle-visualizer`, `@next/bundle-analyzer`) to catch unexpected size growth.
- Set a **bundle size budget** and fail the build if exceeded (e.g., `chunkSizeWarningLimit` in Vite).
- Verify the production build locally before deploying (`npm run build && npm run preview`).

### CI/CD Guardrails

- **Do not modify** CI/CD pipeline files (`.github/workflows/`, `Jenkinsfile`, `buildspec.yml`, etc.) without explicit user approval. These affect every developer and every deployment.
- **Do not add** `--no-verify`, `--force`, or skip flags to CI scripts.
- The CI pipeline should run, at minimum:
  1. `npx tsc --noEmit` (type check)
  2. `npx eslint .` (lint)
  3. `npm test` (unit/integration tests)
  4. `npm run build` (verify production build succeeds)
- For production deployments, add E2E tests (`npx playwright test`) as a gate.

### Preview and Staging

- When the project supports preview deployments (Vercel, Netlify, AWS Amplify), every PR should get a preview URL.
- Do not merge to the main branch without passing CI checks.
- Test against the staging/preview environment, not just localhost — environment differences (CORS, auth, API endpoints) cause real bugs.

---

## Large Project Maintenance Rules

### Dependency Management

- Run `npm audit` monthly (or in CI). Fix **critical** and **high** severity vulnerabilities immediately.
- Update dependencies incrementally, not all at once. One major version bump per PR so regressions are traceable.
- Pin major versions in `package.json` (e.g., `"react": "^19.0.0"`). Use a lockfile (`package-lock.json`) and commit it.
- Remove unused dependencies (`npx depcheck`). They add attack surface and slow installs.

### Dead Code Removal

- Delete unused components, hooks, utilities, types, and feature flags whose rollout is complete. Do not comment them out.
- Use `noUnusedLocals` / `noUnusedParameters` and periodically run `npx ts-unused-exports tsconfig.json` to find stale exports.

### Refactoring

- **Only refactor when explicitly asked** or when a refactor is required to complete the task safely.
- **Scope refactors tightly.** A refactor PR should do one thing: rename, extract, restructure, or migrate. Never mix refactoring with feature work.
- When refactoring, ensure tests exist _before_ starting. If they don't, write them first.
- When identifying tech debt during a task, **flag it to the user** with a specific description. Do not silently fix it — the user decides priority.

### Incremental Migration

When migrating patterns (class → hooks, Redux → Zustand, CSS-in-JS → Tailwind):

- **Never** do a big-bang migration. Migrate incrementally, one feature/module at a time. Old and new patterns can coexist temporarily.
- Document which pattern is canonical (in this CLAUDE.md) so new code uses it. Example: "New code MUST use Zustand; do not add new Redux slices."
- Each migration PR should be self-contained: migrate one module, update its tests, verify nothing broke.

### Performance Budgets

- Set and enforce bundle size limits. Track them in CI using [size-limit](https://github.com/ai/size-limit).
- Monitor Core Web Vitals (LCP, INP, CLS) in production. Performance degrades gradually — without monitoring, you won't notice until users complain.
- When adding a new dependency, check its size impact on [bundlephobia.com](https://bundlephobia.com) before installing.
- Prefer smaller alternatives when functionality is equivalent:

  | Category | Instead of | Consider | Approx. size saving |
  | --- | --- | --- | --- |
  | **Dates** | `moment` (300 KB) | `date-fns` (tree-shakeable) or `dayjs` (2 KB) | ~95% smaller |
  | **Utilities** | `lodash` (70 KB) | Native JS or `lodash-es` (tree-shakeable) | ~90% smaller |
  | **HTTP** | `axios` (13 KB) | Native `fetch` + tiny wrapper | ~100% smaller |
  | **IDs** | `uuid` (3 KB) | `crypto.randomUUID()` (native) | Zero dependency |
  | **IDs (Node <19)** | `uuid` (3 KB) | `nanoid` (~130 bytes) | ~96% smaller |
  | **State mgmt** | MobX (~16 KB) | Valtio (~3 KB) or Zustand (~1 KB) | ~80-95% smaller |
  | **Data fetching** | Apollo Client (~33 KB) | SWR (~4 KB) or TanStack Query (~12 KB) | ~60-88% smaller |
  | **Deep equality** | `lodash.isEqual` (~18 KB with lodash) | `fast-deep-equal` (~1.5 KB) | ~92% smaller |
  | **Classnames** | `classnames` (1 KB) | `clsx` (239 bytes) | ~76% smaller |

### Monorepo Considerations

If the project is a monorepo (Turborepo, Nx, pnpm workspaces):

- Shared packages should have clear ownership and versioning.
- Do not import directly from another app's `src/`. Import from the shared package's public API.
- Changes to shared packages affect all consumers — run all downstream tests before merging.
- Keep `tsconfig` inheritance clean: base config at root, app-specific overrides in each package.

---

## When Creating a New React Project

Follow this setup checklist:

1. Scaffold with `npm create vite@latest -- --template react-ts`
2. Enable `strict: true` in `tsconfig.json`
3. Install and configure ESLint with all plugins listed above
4. Install Prettier + `prettier-plugin-tailwindcss`
5. Set up Husky + lint-staged for pre-commit hooks
6. Install a data-fetching library (SWR or TanStack Query)
7. Install `react-error-boundary`
8. Install a headless UI library (Headless UI, Radix, Ark UI, or shadcn/ui)
9. Create the directory structure outlined above
10. Create a `cn()` utility for class composition (if using Tailwind)
11. Create `useContextHook` wrapper with null-check pattern
12. Set up `React.lazy` code splitting for routes
13. Add at least one integration test for the critical path
14. Add Error Boundaries at app and feature levels
15. Create `.env.example` with placeholder values for all required env vars
16. Set up CI pipeline: type check, lint, test, build

---

## When Working on an Existing React Project

Before making changes:

1. **Read** the relevant files first. Understand existing patterns before modifying.
2. **Follow** existing conventions in the codebase, even if they differ from these rules. Consistency within a project beats theoretical best practices.
3. **Do not refactor** code unrelated to your task. A bug fix does not need surrounding code cleaned up.
4. **Do not add** types, comments, or documentation to code you did not change.
5. **Do not introduce** new patterns or libraries without explicit user approval.
6. **Match** the existing naming conventions, file organization, and code style.
7. **Test** your changes. Run existing tests to verify you have not broken anything.

---

## Checklist Before Completing Any Task

Before declaring work complete, verify:

- [ ] TypeScript compiles with zero errors (`npx tsc --noEmit`)
- [ ] ESLint passes with zero errors (`npx eslint .`)
- [ ] All existing tests pass (`npm test`)
- [ ] New code has error handling (try/catch for async, error boundaries for render)
- [ ] New interactive elements are keyboard accessible
- [ ] New images have alt text
- [ ] No `any` types added without justification
- [ ] No commented-out code left behind
- [ ] No `console.log` left in production code
- [ ] No hardcoded strings in JSX (externalize to content/i18n files if project uses them)
- [ ] List items use stable, unique keys
- [ ] No hardcoded API URLs or secrets — environment variables used correctly
- [ ] No CI/CD pipeline files modified without explicit approval
- [ ] New dependencies justified (checked size impact, no smaller alternative available)

---

## Project-Specific Overrides

### State Management & Data Fetching

(overrides the "State Management Rules" and "Data Fetching Rules" sections above for this project)

- **Do not use SWR, TanStack Query, or Zustand.** Decided 2026-07-16 — see `docs/DECISIONS.md`.
  Data fetching uses plain `useState`/`useEffect` hooks in each feature's `hooks/` folder, wrapping
  `api/` functions. See `frontend/CLAUDE.md` for the exact convention (feature vertical-slice
  shape: `api/` / `hooks/` / `components/` / `index.ts`).
- Shared state stays lifted to the closest common parent or passed via narrowly-scoped Context per
  the general Context Rules above. Do not introduce Zustand (or Redux) unless a specific case of
  prop-drilling/cross-tree state genuinely can't be solved that way — ask before adding it.
- If fetch needs grow (caching, retries, dedup, mutations) to the point plain hooks become painful,
  raise it explicitly rather than silently reaching for TanStack Query — this is a deliberate,
  revisitable tradeoff, not an oversight.

### Backend Architecture

- Supabase Edge Functions are the sole AI gateway; Postgres (RLS + single-writer `apply_diff` +
  `state_version`) is the sole state authority — per `MAIN-SPEC.md`. The prototype
  `backend/main.py` standalone Python process + SQLite (`backend/data/campaigns.db`) is being
  replaced, not repointed. See `TASK.md` §3-4 for what prototype code is worth reusing as reference.
- **Exception (2026-07-24, F12 Assets Lab):** `backend/` is now also the **local asset worker** —
  not just reference. `backend/assets.py` + `backend/image.py` + `backend/tts.py` serve local
  image/TTS generation over the `assets:{user_id}` Realtime channel, uploading results to the
  private `assets` Storage bucket. This is a real runtime for on-device GPU media generation, which
  never belonged in an edge function; it does not touch game-state authority (still Postgres) or
  the AI _text_ gateway (still ai-proxy). Set `ASSETS_USER_ID` in `backend/.env`; run `uv run
  main.py`. See `DECISIONS.md` 2026-07-24.
- **No Docker on the dev machine.** Do not suggest or rely on `supabase start` / `supabase db
  reset` for local dev — apply migrations with `supabase db push --db-url
  <POSTGRES_URL_NON_POOLING>` and seed data with `node supabase/seed/apply-seed.mjs
  "$POSTGRES_URL_NON_POOLING"` (Docker-free; both verified working against the real linked
  project). Do NOT use `db push --include-seed` — verified it only runs the seed file once and
  silently no-ops on later changes. Verify via the hosted Supabase Studio, not a local one. See
  `docs/DECISIONS.md` (2026-07-17) and
  `supabase/README.md`. CI (`.github/workflows/ci.yml`) still uses Docker via GitHub Actions'
  hosted runners — that's unaffected and remains the from-scratch migrations check.

### Auth

- v1 ships Supabase email/password only. Google/Discord OAuth (called for in F01) is deferred to
  backlog. Because there's no OAuth identity layer as a second factor, protected-route/page guards
  (lobby membership, DM-only views, session access) need explicit test coverage — don't assume
  "logged in" is equivalent to "authorized for this resource."
