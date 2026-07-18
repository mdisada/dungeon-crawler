-- Phase 1 (F01 SS3.3): optional per-user OpenRouter key, encrypted server-side via Supabase Vault
-- (supabase_vault, already enabled on this project) rather than hand-rolled pgsodium calls.
-- Only a pointer to the encrypted secret is stored here; the decrypted value is never read by
-- anything except the ai-proxy edge function (service role), which reads vault.decrypted_secrets.

create table user_api_keys (
  user_id uuid primary key references auth.users (id) on delete cascade,
  vault_secret_id uuid not null,
  created_at timestamptz not null default now()
);

alter table user_api_keys enable row level security;

-- Select-only: confirms "a key is set" without exposing it. Insert/update/delete happen only
-- through an edge function using vault.create_secret/vault.update_secret with the service role.
create policy "user_api_keys_select_own" on user_api_keys
  for select using (auth.uid() = user_id);
