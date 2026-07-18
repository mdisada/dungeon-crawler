-- Phase 1 (F01 SS3.4): single-row cache for the platform OpenRouter key's remaining credit,
-- refreshed at most once per 60s by the ai-credit edge function. No RLS/grants for
-- anon/authenticated -- only the edge function's service-role client ever touches this table.

create table openrouter_credit_cache (
  id boolean primary key default true,
  credit_usd numeric,
  fetched_at timestamptz,
  constraint openrouter_credit_cache_single_row check (id)
);

insert into openrouter_credit_cache (id) values (true);
