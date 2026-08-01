-- Restart an adventure from its guide (2026-08-01).
--
-- Replaying a guide means putting the adventure back to the moment before anyone played it. The
-- obvious approach - reset the columns play is known to mutate - cannot work: the story CREATES
-- content mid-play (npcs in session/beats.ts, locations in scene-director.ts, ingredients in
-- npc-dialogue.ts) and the live-npc insert deliberately sets generated=false so the cast
-- machinery treats those rows as real. Nothing in the schema separates them from guide-authored
-- rows, so a column-level reset would silently accumulate invented cast on every replay.
--
-- So: snapshot the guide when the adventure first enters play, and restore that snapshot on
-- restart. Restoring IN PLACE is what makes this cheap - the adventure_id and every row uuid stay
-- exactly as they were, so no cross-reference needs remapping (the reason cloning an adventure
-- was rejected on 2026-08-01).
--
-- Table discovery is dynamic (any table with an FK to adventures), so guide tables added later
-- are covered without touching this file. The one hand-maintained list is PLAY_TABLES below:
-- tables that hold a playthrough rather than a guide. Forgetting to add a new one there means a
-- restart preserves some play data - visible and harmless, not corruption.

create table guide_snapshots (
  adventure_id uuid primary key references adventures (id) on delete cascade,
  captured_at timestamptz not null default now(),
  -- 'activate': captured at the guide -> play transition, exact.
  -- 'backfill': reconstructed for an adventure that had already played, best-effort.
  source text not null check (source in ('activate', 'backfill')),
  payload jsonb not null
);

alter table guide_snapshots enable row level security;

-- DM-only visibility; all writes are service-role (no insert/update/delete policies).
create policy "guide_snapshots_select_dm" on guide_snapshots
  for select using (is_adventure_dm(adventure_id));

-- Tables that hold a PLAYTHROUGH: cleared by a restart, never captured into a snapshot.
create or replace function play_scoped_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'sessions', 'checkpoints', 'session_summaries', 'event_log', 'adventure_state',
    'beats', 'core_loops', 'quest_offers', 'proposals', 'npc_dispositions',
    'npc_interactions', 'personal_bindings', 'memory_fragments', 'meta_loop'
  ]::text[]
$$;

-- Tables a restart must not touch at all: the seats, the cost ledger, lab bookkeeping, guide-time
-- job/warning records, and the generated-image library (assets outlive any single playthrough).
create or replace function restart_exempt_tables()
returns text[]
language sql
immutable
as $$
  select array[
    'adventure_members', 'usage_log', 'lab_runs', 'guide_jobs', 'guide_warnings',
    'location_media', 'guide_snapshots'
  ]::text[]
$$;

/**
 * Every table with a foreign key to adventures(id), minus the exempt list. Dynamic on purpose:
 * a guide table added by a later migration is picked up with no edit here.
 */
create or replace function adventure_scoped_tables()
returns text[]
language sql
stable
as $$
  select coalesce(array_agg(distinct rel.relname::text), '{}'::text[])
  from pg_constraint c
  join pg_class rel on rel.oid = c.conrelid
  join pg_class ref on ref.oid = c.confrelid
  join pg_namespace n on n.oid = rel.relnamespace
  where c.contype = 'f'
    and ref.relname = 'adventures'
    and n.nspname = 'public'
    and not (rel.relname::text = any (restart_exempt_tables()))
$$;

/**
 * Adventure-scoped tables in dependency order: parents before children. Iterative rather than a
 * recursive CTE so a foreign-key cycle cannot loop forever - anything still unplaced when the
 * loop stops making progress is emitted last (the only cycle in this schema is
 * sessions <-> checkpoints, and both sides are `on delete set null`, so ordering cannot break
 * their delete; neither ever appears in a snapshot).
 */
create or replace function adventure_table_order()
returns text[]
language plpgsql
stable
as $$
declare
  v_all text[] := adventure_scoped_tables();
  v_remaining text[] := v_all;
  v_ordered text[] := '{}'::text[];
  v_ready text[];
begin
  while array_length(v_remaining, 1) is not null loop
    select coalesce(array_agg(t), '{}'::text[])
      into v_ready
      from unnest(v_remaining) as t
     where not exists (
       select 1
       from pg_constraint c
       join pg_class rel on rel.oid = c.conrelid
       join pg_class ref on ref.oid = c.confrelid
       where c.contype = 'f'
         and rel.relname::text = t
         and ref.relname::text <> t
         and ref.relname::text = any (v_remaining)
     );

    -- No progress means a cycle: emit what is left and stop.
    if array_length(v_ready, 1) is null then
      v_ordered := v_ordered || v_remaining;
      exit;
    end if;

    v_ordered := v_ordered || v_ready;
    select coalesce(array_agg(t), '{}'::text[])
      into v_remaining
      from unnest(v_remaining) as t
     where not (t = any (v_ready));
  end loop;

  return v_ordered;
end;
$$;

/**
 * Capture the guide as it stands into guide_snapshots.
 *
 * `activate` is the exact case: called at the guide -> play transition, when the only rows that
 * exist are guide-authored ones, so it is a plain copy.
 *
 * `backfill` reconstructs a baseline for an adventure that ALREADY played, and is best-effort by
 * construction: rows created after the first session started are treated as play-created and
 * dropped, and the columns play is known to mutate are reverted. It cannot be exact - that is
 * precisely why the activate-time capture exists.
 */
create or replace function capture_guide_snapshot(p_adventure_id uuid, p_source text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_cutoff timestamptz;
  v_where text;
  v_override text;
  v_rows jsonb;
  v_payload jsonb := '{}'::jsonb;
  v_total integer := 0;
begin
  if p_source not in ('activate', 'backfill') then
    raise exception 'capture_guide_snapshot: unknown source %', p_source;
  end if;

  if p_source = 'backfill' then
    select min(started_at) into v_cutoff from sessions where adventure_id = p_adventure_id;
  end if;

  foreach v_table in array adventure_table_order() loop
    continue when v_table = any (play_scoped_tables());

    v_where := 'adventure_id = $1';
    v_override := '{}';

    if p_source = 'backfill' then
      -- Anything the story created after play began is not guide content.
      -- The cutoff is inlined as a literal rather than a second USING parameter: PL/pgSQL
      -- rejects an EXECUTE whose argument count does not match the placeholders, and this
      -- clause is only present for some tables.
      if v_cutoff is not null and exists (
        select 1 from information_schema.columns
        where table_schema = 'public' and table_name = v_table and column_name = 'created_at'
      ) then
        v_where := v_where || format(' and created_at < %L', v_cutoff);
      end if;

      -- Rows play invents outright, and the columns play advances in place.
      case v_table
        when 'objectives' then v_override := '{"reveal_state": "hidden", "outcome": null}';
        when 'ingredients' then v_override := '{"discovered": false}';
        when 'endings' then
          v_where := v_where || ' and is_emergent = false';
          v_override := '{"status": "candidate"}';
        when 'story_atoms' then v_where := v_where || ' and scope <> ''local''';
        when 'hooks' then v_where := v_where || ' and coalesce(from_ref->>''table'', '''') <> ''live''';
        else null;
      end case;
    end if;

    execute format(
      'select coalesce(jsonb_agg(to_jsonb(t) || %L::jsonb), ''[]''::jsonb) from %I t where %s',
      v_override, v_table, v_where
    )
    into v_rows
    using p_adventure_id;

    if jsonb_array_length(v_rows) > 0 then
      v_payload := v_payload || jsonb_build_object(v_table, v_rows);
      v_total := v_total + jsonb_array_length(v_rows);
    end if;
  end loop;

  insert into guide_snapshots (adventure_id, source, payload, captured_at)
  values (p_adventure_id, p_source, v_payload, now())
  on conflict (adventure_id) do update
    set source = excluded.source, payload = excluded.payload, captured_at = excluded.captured_at;

  return v_total;
end;
$$;

/**
 * Put the adventure back to its captured guide: clear every adventure-scoped row (guide AND
 * playthrough), then re-insert the snapshot with its original primary keys. One transaction - a
 * half-restored adventure would be worse than a played one.
 *
 * Callers must broadcast `resync_required`; this function does not reach Realtime.
 */
create or replace function restart_adventure(p_adventure_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order text[] := adventure_table_order();
  v_table text;
  v_rows jsonb;
  v_payload jsonb;
  v_restored integer := 0;
  i integer;
begin
  select payload into v_payload from guide_snapshots where adventure_id = p_adventure_id;
  if v_payload is null then
    raise exception 'restart_adventure: no guide snapshot for %', p_adventure_id;
  end if;

  -- Children first, so a delete never trips a foreign key.
  for i in reverse array_length(v_order, 1) .. 1 loop
    v_table := v_order[i];
    execute format('delete from %I where adventure_id = $1', v_table) using p_adventure_id;
  end loop;

  -- Parents first, restoring original uuids so every cross-reference lands exactly as authored.
  foreach v_table in array v_order loop
    v_rows := v_payload -> v_table;
    continue when v_rows is null or jsonb_array_length(v_rows) = 0;
    execute format(
      'insert into %I select * from jsonb_populate_recordset(null::%I, $1)', v_table, v_table
    ) using v_rows;
    v_restored := v_restored + jsonb_array_length(v_rows);
  end loop;

  -- The adventure is playable again, with the live dials the last run tuned dropped.
  update adventures
     set status = 'active',
         dial_values = '{}'::jsonb,
         updated_at = now()
   where id = p_adventure_id;

  -- Nobody is ready for a run that has not been set up yet; the lobby is the honest entry point.
  update adventure_members set ready = false where adventure_id = p_adventure_id;

  return v_restored;
end;
$$;

-- PostgREST exposes public-schema functions to `authenticated`, and these two are destructive
-- (restart_adventure deletes every adventure-scoped row). They are reachable ONLY through the
-- session edge function, which holds the service role.
revoke all on function capture_guide_snapshot(uuid, text) from public, anon, authenticated;
revoke all on function restart_adventure(uuid) from public, anon, authenticated;
grant execute on function capture_guide_snapshot(uuid, text) to service_role;
grant execute on function restart_adventure(uuid) to service_role;

comment on table guide_snapshots is
  'The guide as it stood when the adventure first entered play. Restored verbatim by '
  'restart_adventure() so a guide can be played from scratch repeatedly.';
