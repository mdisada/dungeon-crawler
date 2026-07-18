-- Phase 1 (F01 SS5): local-server mode contract. v1 ships token generation, heartbeat, and the
-- navbar connection indicator only -- no worker implementation required to launch (see spec).

create table worker_tokens (
  user_id uuid primary key references auth.users (id) on delete cascade,
  token_hash text not null,
  created_at timestamptz not null default now()
);

alter table worker_tokens enable row level security;

-- Select-only (confirms a token exists / when it was made). Generation/rotation goes through an
-- edge function so the plaintext token is only ever returned once, at creation time.
create policy "worker_tokens_select_own" on worker_tokens
  for select using (auth.uid() = user_id);

create table worker_status (
  user_id uuid primary key references auth.users (id) on delete cascade,
  last_heartbeat_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table worker_status enable row level security;

create policy "worker_status_select_own" on worker_status
  for select using (auth.uid() = user_id);
