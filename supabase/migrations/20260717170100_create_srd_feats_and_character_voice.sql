-- F02 review round: feats reference data + character voice.
--
-- srd_feats: SRD 5.2.1 feats from Open5e /v2/feats (17 rows incl. the 4 Origin feats that
-- backgrounds grant). Needed so the Background step can show what an Origin feat actually does
-- instead of just its name; F11 Progression will need the full feat list later anyway.
-- Read-all policy, same posture as every other srd_* reference table.
create table srd_feats (
  key text primary key,
  name text not null,
  feat_type text,
  description text,
  benefits jsonb not null default '[]'::jsonb,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

alter table srd_feats enable row level security;
create policy "srd_feats_read_all" on srd_feats for select using (true);

-- characters.voice: the player-chosen narration voice for this character (F02 review request).
-- Shape: {"source": "default"} or {"source": "clip", "clipPath": "<storage path>"}. The clip is
-- stored in the private characters bucket under {character_id}/; actual voice cloning against the
-- TTS provider is Phase 3 (F12) work - this only captures the choice + sample.
alter table characters add column voice jsonb not null default '{}'::jsonb;
