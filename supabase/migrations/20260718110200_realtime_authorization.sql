-- Phase 4 (F06 SS6): Realtime Authorization for the three private per-adventure channels.
--
--   lobby:{adventure_id}  presence (who's connected, F05 SS3) - members send + receive
--   game:{adventure_id}   state-diff broadcasts - members receive; only the server sends
--                         (service role bypasses these policies)
--   dm:{adventure_id}     DM-only domains (proposals from F07 on) - DM receives
--
-- Clients must join with { config: { private: true } }; these policies on realtime.messages
-- are what makes the F06 "DM-only data never reaches player clients" guarantee hold at the
-- network level rather than by client courtesy.

-- realtime.topic() is free text from the client; a malformed uuid segment must mean "no
-- access", not a cast error aborting the join.
create function topic_adventure_id() returns uuid
language plpgsql stable as $$
begin
  return split_part(realtime.topic(), ':', 2)::uuid;
exception when others then
  return null;
end $$;

create policy "adventure_channels_receive" on realtime.messages
  for select to authenticated
  using (
    case split_part(realtime.topic(), ':', 1)
      when 'lobby' then is_adventure_member(topic_adventure_id())
      when 'game' then is_adventure_member(topic_adventure_id())
      when 'dm' then is_adventure_dm(topic_adventure_id())
      else false
    end
  );

-- Only the lobby channel accepts client sends, and only for presence tracking. Game-state
-- writes go through the session edge function; nothing a player client sends is ever treated
-- as authoritative state.
create policy "lobby_presence_send" on realtime.messages
  for insert to authenticated
  with check (
    split_part(realtime.topic(), ':', 1) = 'lobby'
    and realtime.messages.extension = 'presence'
    and is_adventure_member(topic_adventure_id())
  );
