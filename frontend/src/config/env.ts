export const env = {
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
  supabaseAnonKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  // F02: skip real image-gen calls and use frontend/public/placeholders/*.png instead. Required
  // to be usable from Phase 2 onward per DEVELOPMENT-PLAN.md SS1.3.
  placeholderMedia: import.meta.env.VITE_PLACEHOLDER_MEDIA === 'true',
} as const
