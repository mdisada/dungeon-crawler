// Same-origin SPA calling its own project's edge functions; a permissive ACAO is standard
// Supabase edge-function boilerplate since the anon key is already public by design.
export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
