// `lib/supabase.ts` calls createClient at module scope, so ANY test that transitively imports it
// dies on import when these are unset - and CI has no VITE_* vars, so three suites failed to load
// at all ("supabaseUrl is required", red on main since 2026-07-18). A test never talks to Supabase;
// it only needs the import to survive.
//
// Scoped to MODE === 'test' deliberately. A missing URL in a dev or production build must still
// throw loudly rather than silently point a deployed app at a placeholder.
// Declared `string` in vite-env.d.ts, so the return stays `string` and every one of the 48
// consumers is unaffected. Outside tests the value passes through exactly as it did before -
// including empty, so a misconfigured deploy still fails at createClient rather than here.
const testFallback = (value: string, whenTesting: string): string =>
  value || (import.meta.env.MODE === 'test' ? whenTesting : value)

export const env = {
  supabaseUrl: testFallback(import.meta.env.VITE_SUPABASE_URL, 'http://localhost:54321'),
  supabaseAnonKey: testFallback(import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, 'test-anon-key'),
  // F02: skip real image-gen calls and use frontend/public/placeholders/*.png instead. Required
  // to be usable from Phase 2 onward per DEVELOPMENT-PLAN.md SS1.3.
  placeholderMedia: import.meta.env.VITE_PLACEHOLDER_MEDIA === 'true',
} as const
