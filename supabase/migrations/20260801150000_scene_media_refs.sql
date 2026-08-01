-- Carry the FILE in scene state, not an hour-old link to it.
--
-- GameState.scene held `backgroundUrl`: a signed URL, minted with a 1h TTL and then written into
-- adventure_state, which is durable. It was only ever re-minted at session start and on a location
-- change, and `resync` returns the stored state verbatim - so an hour into any session the backdrop
-- died and stayed dead. Measured 2026-08-01: the two active adventures were carrying background
-- tokens that had expired 472 and 591 minutes earlier. speaker-stage.tsx had already grown a
-- silhouette fallback for the same rot on NPC portraits.
--
-- State now carries `background: { bucket, path }` and the client signs it at render time against
-- its own session, which is what the guide editor has always done (useMediaUrl). A path cannot
-- expire.
--
-- This backfills the sessions that already exist. Without it they keep a dead `backgroundUrl` and
-- no `background`, so they would render nothing until someone happened to change location - a fix
-- that does not reach the tables it was written for.
--
-- Only `scene` is repaired. `dialogue.speakers[].image` and `combat.tokens[].image` are per-element
-- inside arrays and both are short-lived - a staged cast is re-staged on the next social scene and
-- combat state is torn down when the fight ends - so the stale keys there are inert and get
-- rewritten in the normal course of play.

update adventure_state s
set state = jsonb_set(
      s.state #- '{scene,backgroundUrl}',
      '{scene,background}',
      case
        when l.background_url is null or l.background_url = '' then 'null'::jsonb
        else jsonb_build_object('bucket', 'adventure-media', 'path', l.background_url)
      end,
      true
    )
from locations l
where l.id::text = s.state #>> '{scene,locationId}'
  and s.state #> '{scene}' ? 'backgroundUrl';

-- Sessions whose scene has no location resolved (lobby, or a location row since deleted) still
-- need the dead key gone and the new one present, or the renderer reads `undefined` forever.
update adventure_state s
set state = jsonb_set(s.state #- '{scene,backgroundUrl}', '{scene,background}', 'null'::jsonb, true)
where s.state #> '{scene}' ? 'backgroundUrl';
