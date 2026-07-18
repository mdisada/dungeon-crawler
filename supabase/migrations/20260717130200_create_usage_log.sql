-- Phase 1 (F01 SS3.4): per-request AI usage/cost log. Written only by the ai-proxy edge function
-- (service role, bypasses RLS) after a stream completes; drives the navbar usage meter and
-- per-adventure cost totals.
--
-- adventure_id is a bare uuid with no FK: the adventures table doesn't exist yet (F5, Phase 4).
-- Add the FK constraint in a later migration once adventures lands.

create table usage_log (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  adventure_id uuid,
  agent_role text not null,
  model text not null,
  kind text not null check (kind in ('text', 'tts', 'image', 'embedding')),
  prompt_tokens integer,
  completion_tokens integer,
  cost_usd numeric,
  latency_ms integer,
  created_at timestamptz not null default now()
);

alter table usage_log enable row level security;

-- Select-own only. No insert/update/delete policy for the authenticated role on purpose:
-- only the edge function's service-role client (which bypasses RLS entirely) writes rows.
create policy "usage_log_select_own" on usage_log
  for select using (auth.uid() = user_id);

create index usage_log_user_id_created_at_idx on usage_log (user_id, created_at desc);
