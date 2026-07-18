-- Phase 1 (F01 SS2, SS4): user profile + per-user AI settings.
-- A row in each is auto-provisioned by handle_new_user() whenever a new auth.users row appears,
-- so the client never needs a "create my profile" step after sign-up.

create table profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now()
);

alter table profiles enable row level security;

create policy "profiles_select_own" on profiles
  for select using (auth.uid() = id);

create policy "profiles_update_own" on profiles
  for update using (auth.uid() = id);

create table user_settings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  provider text not null default 'openrouter' check (provider in ('openrouter', 'local')),
  -- model_map: { [agent_role]: openrouter_model_slug }. Missing roles fall back to the
  -- MAIN-SPEC SS4.7 system defaults, resolved by supabase/functions/_shared/model-routing.ts.
  model_map jsonb not null default '{}'::jsonb,
  tts_model text not null default 'mistralai/voxtral-mini-tts-2603',
  image_model text not null default 'google/gemini-3.1-flash-lite-image',
  -- Fixed per F01 SS4: changing this invalidates existing embeddings (re-embed job required).
  embedding_model text not null default 'qwen/qwen3-embedding-8b',
  byok_local_storage boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table user_settings enable row level security;

create policy "user_settings_select_own" on user_settings
  for select using (auth.uid() = user_id);

create policy "user_settings_update_own" on user_settings
  for update using (auth.uid() = user_id);

create function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id) values (new.id);
  insert into public.user_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
