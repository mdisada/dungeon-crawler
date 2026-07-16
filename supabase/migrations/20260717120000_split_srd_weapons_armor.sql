-- Phase 0 follow-up (DESIGN REVIEW note "SPLIT NOW", docs/CHECKPOINTS/PHASE0.md): normalizes the
-- weapon/armor stats that were previously only inside srd_items.data jsonb. srd_items stays as
-- the full catalog (all 440 rows, every category); srd_weapons and srd_armor hold the subset of
-- items whose Open5e payload has a non-null `weapon` / `armor` object, keyed 1:1 to srd_items.

create table if not exists srd_weapons (
  key text primary key references srd_items (key) on delete cascade,
  damage_type text,
  damage_dice text,
  is_simple boolean not null default false,
  is_martial boolean not null default false,
  is_improvised boolean not null default false,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

create table if not exists srd_armor (
  key text primary key references srd_items (key) on delete cascade,
  armor_category text,
  ac_base integer,
  ac_add_dexmod boolean not null default false,
  ac_cap_dexmod integer,
  grants_stealth_disadvantage boolean not null default false,
  strength_score_required integer,
  data jsonb not null,
  source text not null default 'srd-5.2.1'
);

create index if not exists srd_weapons_damage_type_idx on srd_weapons (damage_type);
create index if not exists srd_armor_category_idx on srd_armor (armor_category);
