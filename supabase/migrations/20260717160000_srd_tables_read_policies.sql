-- Bug fix (found during F02 manual testing): every SRD table from Phase 0
-- (20260716171413_create_srd_tables.sql, 20260717120000_split_srd_weapons_armor.sql) has RLS
-- enabled with zero policies, so the anon/authenticated PostgREST roles the frontend actually
-- uses have been silently denied all reads since Phase 0. This went undetected because Phase 0's
-- verification queried through Studio's SQL editor (a superuser connection that bypasses RLS),
-- never through the anon-key path. srd_races/srd_backgrounds (added in F02) already have
-- equivalent read-all policies - this migration brings the rest of the SRD tables in line. They
-- are public reference data (no user_id, no ownership), so open read access is correct, not just
-- expedient.

create policy "srd_monsters_read_all" on srd_monsters for select using (true);
create policy "srd_spells_read_all" on srd_spells for select using (true);
create policy "srd_classes_read_all" on srd_classes for select using (true);
create policy "srd_class_features_read_all" on srd_class_features for select using (true);
create policy "srd_items_read_all" on srd_items for select using (true);
create policy "srd_weapons_read_all" on srd_weapons for select using (true);
create policy "srd_armor_read_all" on srd_armor for select using (true);
