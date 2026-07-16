-- Phase 0: SRD 5.2.1 reference data tables (MAIN-SPEC.md SS2, SS7.2).
-- Read-only rules content ingested from a public CC-BY-4.0 SRD 5.2.1 source (see
-- supabase/seed/ingest-srd.mjs and NOTICE.md for attribution). Each table keeps the specific
-- columns Engines need to query/filter on (CR/XP, spell level/school, class table breakpoints)
-- and folds the rest of the source payload into `data jsonb` rather than fully normalizing
-- fields (actions, features prose, equipment stats) no Engine queries yet.

create table if not exists srd_monsters (
  key text primary key,
  name text not null,
  creature_type text,
  size text,
  challenge_rating numeric,
  experience_points integer,
  armor_class integer,
  hit_points integer,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

create table if not exists srd_spells (
  key text primary key,
  name text not null,
  school text,
  level integer,
  concentration boolean not null default false,
  ritual boolean not null default false,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

create table if not exists srd_classes (
  key text primary key,
  name text not null,
  hit_dice text,
  caster_type text,
  subclass_of text references srd_classes (key),
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

create table if not exists srd_class_features (
  key text primary key,
  class_key text not null references srd_classes (key) on delete cascade,
  name text not null,
  feature_type text,
  gained_at jsonb,
  data_for_class_table jsonb,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

-- Full item catalog (Open5e's /items/ endpoint covers general equipment, weapons, and armor in
-- one dataset - see supabase/seed/ingest-srd.mjs); `category` is Open5e's own taxonomy (Weapon,
-- Armor, Adventuring Gear, Tools, ...). Weapon/armor-specific stats are further normalized into
-- srd_weapons / srd_armor (see 20260717120000_split_srd_weapons_armor.sql).
create table if not exists srd_items (
  key text primary key,
  name text not null,
  category text not null,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

create index if not exists srd_monsters_cr_idx on srd_monsters (challenge_rating);
create index if not exists srd_spells_level_idx on srd_spells (level);
create index if not exists srd_class_features_class_key_idx on srd_class_features (class_key);
create index if not exists srd_items_category_idx on srd_items (category);
