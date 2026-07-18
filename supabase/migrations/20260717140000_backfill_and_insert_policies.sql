-- Phase 1 follow-up: the handle_new_user() trigger only provisions profiles/user_settings for
-- users created AFTER it existed. Accounts that predate it have no rows, so the settings page's
-- .single() read errors. Backfill those, and add own-row INSERT policies so the client can
-- self-heal a missing row (belt-and-suspenders alongside the trigger).

insert into public.profiles (id)
select u.id from auth.users u
left join public.profiles p on p.id = u.id
where p.id is null;

insert into public.user_settings (user_id)
select u.id from auth.users u
left join public.user_settings s on s.user_id = u.id
where s.user_id is null;

create policy "profiles_insert_own" on public.profiles
  for insert with check (auth.uid() = id);

create policy "user_settings_insert_own" on public.user_settings
  for insert with check (auth.uid() = user_id);
