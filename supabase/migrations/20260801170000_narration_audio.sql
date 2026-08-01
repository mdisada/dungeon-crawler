-- F12 narration TTS: cached, shared, per-reveal-chunk narration audio.
--
-- Five parts, in dependency order:
--   1. the `narration-audio` bucket (service-role only - see why below)
--   2. `narration_clips`, the cache index + retention ledger
--   3. `claim_narration_clip`, the idempotency primitive two racing clients go through
--   4. a built-in (ownerless) voice profile, so `carl` is available to every user
--   5. the nightly 7-day sweep
--
-- WHY THE BUCKET HAS NO POLICIES. Every other content bucket here is read by the browser, so it
-- carries a select policy (voices/{uid}, characters_storage_select_party, and so on). This one is
-- never read by the browser: `narration-tts` holds the service key, signs each clip as it uploads
-- it, and puts the signed URL straight in the broadcast. Authorization therefore happens once, in
-- the function, against adventure membership - and a bucket with no policy is unreadable by any
-- authenticated role, which is exactly the intent stated rather than implied.

insert into storage.buckets (id, name, public)
values ('narration-audio', 'narration-audio', false)
on conflict (id) do nothing;

-- 2. THE CACHE INDEX -------------------------------------------------------------------------
--
-- Content-addressed: cache_key is sha256(chunk text + voice reference + engine), so a rehearsal
-- run over an adventure played this week costs nothing, and a line whose text was edited misses
-- rather than serving stale audio.
--
-- `scope` is the adventure id for play and 'lab-{user_id}' for the TTS lab, which has no
-- adventure. It is the first path segment and the second half of the uniqueness key, so lab runs
-- can never collide with (or be served from) a real adventure's cache.
create table narration_clips (
  id uuid primary key default gen_random_uuid(),
  scope text not null,
  cache_key text not null,
  storage_path text not null,
  -- Null for lab runs. The FK is what makes deleting an adventure delete its audio ledger; the
  -- objects themselves are then collected by the sweep, which reconciles against this table.
  adventure_id uuid references adventures (id) on delete cascade,
  owner_id uuid not null references auth.users (id) on delete cascade,
  model text not null,
  -- Fish reference_id actually used, or null for Fish's built-in voice. Part of the cache key, so
  -- it is stored for debugging rather than for lookup.
  voice_ref text,
  byte_size integer not null default 0,
  -- Set when a synthesis claims this row; used to detect an invocation that died mid-flight.
  reserved_at timestamptz not null default now(),
  -- Null while synthesis is in flight. Non-null means the object exists and is playable.
  ready_at timestamptz,
  created_at timestamptz not null default now(),
  unique (scope, cache_key)
);

-- The sweep scans by age across every scope, so the index is on the age alone. Lookups by
-- (scope, cache_key) are already served by the unique constraint.
create index narration_clips_created_at_idx on narration_clips (created_at);

alter table narration_clips enable row level security;

-- No policies, deliberately, for the same reason as usage_log: only the edge functions' service-role
-- client touches this table. Clients learn about clips from the broadcast, never by querying.

-- 3. THE IDEMPOTENCY PRIMITIVE ---------------------------------------------------------------
--
-- Two players at one table both see the same new line and both fire narration-tts. Without this
-- they would both pay Fish for identical audio. The insert-or-steal below makes exactly one of
-- them the synthesizer:
--
--   claimed=true   you own this chunk - synthesize it, then mark it ready
--   ready=true     already synthesized - serve `path` from cache, spend nothing
--   neither        someone else is mid-flight - do nothing and wait for their broadcast
--
-- A claim is stealable after RESERVATION_TTL because the alternative is worse: an invocation
-- killed at the 150s edge limit would otherwise leave a tombstone that no later request could ever
-- clear, and that chunk would be permanently silent. 60s is comfortably longer than any single
-- Fish call and comfortably shorter than a player's patience.
create or replace function claim_narration_clip(
  p_scope text,
  p_cache_key text,
  p_storage_path text,
  p_adventure_id uuid,
  p_owner_id uuid,
  p_model text,
  p_voice_ref text
) returns table (claimed boolean, ready boolean, path text)
language plpgsql security definer set search_path = public as $$
declare
  v_claimed boolean;
  v_ready boolean;
  v_path text;
begin
  insert into narration_clips (
    scope, cache_key, storage_path, adventure_id, owner_id, model, voice_ref
  )
  values (
    p_scope, p_cache_key, p_storage_path, p_adventure_id, p_owner_id, p_model, p_voice_ref
  )
  on conflict (scope, cache_key) do update
    set reserved_at = now()
    where narration_clips.ready_at is null
      and narration_clips.reserved_at < now() - interval '60 seconds'
  returning true, narration_clips.ready_at is not null, narration_clips.storage_path
  into v_claimed, v_ready, v_path;

  -- No row came back: the conflicting row was either already ready or still inside its
  -- reservation window. Read it to tell those two apart.
  if v_path is null then
    select false, nc.ready_at is not null, nc.storage_path
    into v_claimed, v_ready, v_path
    from narration_clips nc
    where nc.scope = p_scope and nc.cache_key = p_cache_key;
  end if;

  return query select coalesce(v_claimed, false), coalesce(v_ready, false), v_path;
end $$;

comment on function claim_narration_clip(text, text, text, uuid, uuid, text, text) is
  'Atomically claims one narration chunk for synthesis. Returns claimed=true to exactly one caller '
  'per (scope, cache_key) until the clip is ready or the 60s reservation lapses.';

-- 4. THE BUILT-IN VOICE ----------------------------------------------------------------------
--
-- voice_profiles was per-user from the start (F04 SS5.1), which left no way to ship a voice every
-- account can use. An ownerless row (user_id is null) is that voice: readable by everyone,
-- writable by no one, and registered with Fish exactly once so a single reference_id serves the
-- whole app. Seeded by supabase/seed/seed-builtin-voices.mjs.
alter table voice_profiles alter column user_id drop not null;

create policy "voice_profiles_select_builtin" on voice_profiles
  for select using (user_id is null);

-- The existing insert/update/delete policies compare `auth.uid() = user_id`, which is NULL - never
-- true - for these rows, so they stay read-only to users without any extra clause. narration-tts
-- and the seed script write them with the service role.

create policy "voices_storage_select_builtin" on storage.objects
  for select using (
    bucket_id = 'voices'
    and (storage.foldername(objects.name))[1] = 'builtin'
  );

-- 5. THE NIGHTLY SWEEP -----------------------------------------------------------------------
--
-- Audio expires after 7 days. Expiry is harmless by construction: the cache is content-addressed,
-- so a swept clip is simply re-synthesized the next time that exact text is spoken in that voice.
--
-- Storage has no TTL and deleting a storage.objects row orphans the underlying file, so removal
-- has to go through the Storage API - hence an edge function rather than plain SQL. pg_net posts
-- to it; the URL and service key come from Vault so no secret is committed here.
--
-- ONE-TIME OPERATOR STEP (see supabase/README.md) - until these exist the job posts to a null URL
-- and does nothing, which is a no-op, not a failure:
--   select vault.create_secret('https://<project-ref>.supabase.co', 'project_url');
--   select vault.create_secret('<service-role-key>', 'service_role_key');
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'narration-audio-sweep',
  '17 4 * * *',
  $cron$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'project_url')
           || '/functions/v1/narration-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
    ),
    body := '{}'::jsonb
  );
  $cron$
);

-- 6. REALTIME AUTHORIZATION ------------------------------------------------------------------
--
-- narration:{adventure_id}  chunk-ready broadcasts - members receive; only the server sends
-- narration:lab-{user_id}   the same events for a TTS-lab run, which has no adventure
--
-- Its own topic rather than a new event on game:{id}: the lab has no adventure to authorize
-- against, and keeping audio off the game channel means the state-diff version chain in
-- use-game-state is untouched by anything this feature does.
--
-- Added as a separate policy rather than by editing adventure_channels_receive, because policies
-- are OR'd - so the existing channels' rules are provably unchanged by this migration.
create policy "narration_channel_receive" on realtime.messages
  for select to authenticated
  using (
    split_part(realtime.topic(), ':', 1) = 'narration'
    and case
      when split_part(realtime.topic(), ':', 2) like 'lab-%'
        then split_part(realtime.topic(), ':', 2) = 'lab-' || auth.uid()::text
      else is_adventure_member(topic_adventure_id())
    end
  );
